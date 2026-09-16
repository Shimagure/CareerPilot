"""End-to-end API smoke test for the Candidate Profile (Checkpoint 5).

Runs against a live uvicorn instance and validates the real HTTP surface:
POST /api/auth/register
GET  /api/profile            (empty-state response shape)
POST /api/resume             (upload a DOCX candidate resume)
POST /api/profile/extract    (review-only draft, no persistence)
PUT  /api/profile            (save => user_verified provenance)
GET  /api/profile            (persisted shape, isolation)
Cross-user isolation assertions (user B never sees user A's data).
"""
import io
import json
import os
import sys
import time
import uuid
import zipfile

import httpx

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:8001")

RUN_TAG = f"{int(time.time())}-{uuid.uuid4().hex[:6]}"

PASS = 0
FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  PASS  {name}")
    else:
        FAIL += 1
        print(f"  FAIL  {name} {detail}")


def build_docx_bytes(text_lines):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(
            "[Content_Types].xml",
            '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        )
        body = ""
        for line in text_lines:
            escaped = (
                line.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
            )
            if not line.strip():
                body += '<w:p><w:r><w:t xml:space="preserve"></w:t></w:r></w:p>'
            else:
                body += f'<w:p><w:r><w:t xml:space="preserve">{escaped}</w:t></w:r></w:p>'
        document = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">\n'
            f'<w:body>{body}</w:body></w:document>'
        )
        pkg_rels = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
            '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>\n'
            "</Relationships>"
        )
        zf.writestr("_rels/.rels", pkg_rels)
        zf.writestr("word/_rels/document.xml.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>')
        zf.writestr("word/document.xml", document)
    return buf.getvalue()


RESUME_LINES = [
    "Wilson Chiquito",
    "IT Support Specialist",
    "Muzon, San Jose del Monte, Bulacan, Philippines",
    "light.jukes@gmail.com",
    "+63 912 345 6789",
    "",
    "SKILLS",
    "Active Directory, Windows 10/11, Microsoft 365, PowerShell",
    "",
    "EXPERIENCE",
    "End User Computing Technician",
    "Solaire Resort & Casino  July 2023 - May 2026",
    "- Provided Tier 2 technical support",
    "- Managed Active Directory users",
    "",
    "EDUCATION",
    "BS Information Technology | Bulacan State Agricultural University | 2018 - 2022",
]


def register(client, email):
    r = client.post("/api/auth/register", json={"email": email, "password": "TestPass123!"})
    return r


def main():
    client = httpx.Client(base_url=BASE, timeout=20)

    print("== A. Auth + empty state ==")
    email_a = f"smoke_a_{RUN_TAG}@example.com"
    r1 = register(client, email_a)
    if r1.status_code != 200:
        r1 = client.post("/api/auth/login", json={"email": email_a, "password": "TestPass123!"})
    tok_a = r1.json()["access_token"]
    ha = {"Authorization": f"Bearer {tok_a}"}
    check("user A registered/logged in", bool(tok_a))

    r = client.get("/api/profile", headers=ha)
    check("GET /api/profile returns 200", r.status_code == 200, r.text)
    body = r.json()
    check("profile null on empty state", body.get("profile") is None, json.dumps(body)[:200])
    check("has_active_resume present", "has_active_resume" in body)
    check("no active resume initially", body["has_active_resume"] is False)

    r = client.get("/api/profile")
    check("GET without token = 401", r.status_code == 401)
    r = client.get("/api/profile", headers={"Authorization": "Bearer invalid.token"})
    check("GET with invalid token = 401", r.status_code == 401)

    print("== B. Extract requires a resume ==")
    r = client.post("/api/profile/extract", headers=ha)
    check("extract without resume = 404", r.status_code == 404, r.text)

    print("== C. Upload resume (DOCX) ==")
    files = {"file": ("resume.docx", build_docx_bytes(RESUME_LINES), "application/octet-stream")}
    r = client.post("/api/resume", headers=ha, files=files)
    check("resume upload = 200", r.status_code in (200, 201), f"{r.status_code}: {r.text[:300]}")

    print("== D. Extract draft (review-only) ==")
    r = client.post("/api/profile/extract", headers=ha)
    check("extract with resume = 200", r.status_code == 200, r.text[:300])
    draft = r.json()
    check("draft has_text", draft.get("has_text") is True, json.dumps(draft)[:200])
    check("draft has no warning", draft.get("warning") is None, str(draft.get("warning")))
    prof = draft.get("draft") or {}
    check("draft includes full_name", prof.get("full_name") == "Wilson Chiquito", json.dumps(prof)[:200])

    skills = prof.get("skills") or []
    check("draft has skills", len(skills) > 0, json.dumps(skills)[:200])
    if skills:
        check("draft skill source = resume_extracted", skills[0].get("source") == "resume_extracted", str(skills[0]))

    # Extraction must NOT persist
    r = client.get("/api/profile", headers=ha)
    check("extract does not persist (profile still null)", r.json().get("profile") is None)

    print("== E. Save profile (PUT) ==")
    payload = {
        "full_name": "Wilson Chiquito",
        "headline": "IT Support Specialist",
        "email": "light.jukes@gmail.com",
        "phone": "+63 912 345 6789",
        "location": "Muzon, San Jose del Monte, Bulacan, Philippines",
        "skills": [
            {"name": "Active Directory", "source": "user_verified"},
            {"name": "Windows 10/11", "source": "user_verified"},
        ],
        "experience": [
            {
                "employer": "Solaire Resort & Casino",
                "title": "End User Computing Technician",
                "start_date": "2023-07",
                "end_date": "2026-05",
                "description": "Provided Tier 2 technical support",
                "source": "user_verified",
            }
        ],
    }
    r = client.put("/api/profile", headers=ha, json=payload)
    check("PUT /api/profile = 200", r.status_code == 200, r.text[:300])
    saved = r.json()
    check("saved profile has name", saved.get("full_name") == "Wilson Chiquito")
    check("saved skill is user_verified", (saved.get("skills") or [{}])[0].get("source") == "user_verified")
    check("saved experience persisted", len(saved.get("experience") or []) == 1)
    check("manually_edited = true", saved.get("manually_edited") is True)

    print("== F. Persisted GET ==")
    r = client.get("/api/profile", headers=ha)
    got = r.json()
    check("GET returns saved profile", got["profile"] is not None)
    check("saved name round-trips", got["profile"]["full_name"] == "Wilson Chiquito")
    check("saved skill round-trips", (got["profile"]["skills"] or [{}])[0]["name"] == "Active Directory")

    print("== G. Cross-user isolation ==")
    email_b = f"smoke_b_{RUN_TAG}@example.com"
    r2 = register(client, email_b)
    if r2.status_code != 200:
        r2 = client.post("/api/auth/login", json={"email": email_b, "password": "TestPass123!"})
    tok_b = r2.json()["access_token"]
    hb = {"Authorization": f"Bearer {tok_b}"}

    r = client.get("/api/profile", headers=hb)
    check("user B starts with null profile", r.json().get("profile") is None, r.text[:200])

    # B cannot PUT into A's profile — B simply has its own empty profile, nothing leaks.
    rb = client.put("/api/profile", headers=hb, json={"full_name": "User B", "skills": [{"name": "Ruby", "source": "user_verified"}]})
    check("user B CAN save its own profile", rb.status_code == 200, rb.text[:200])

    # A still has its data intact after B's write.
    r = client.get("/api/profile", headers=ha)
    check("user A data intact after B writes", r.json()["profile"]["full_name"] == "Wilson Chiquito")

    # B's profile name is B's own.
    r = client.get("/api/profile", headers=hb)
    check("user B sees only own data", r.json()["profile"]["full_name"] == "User B")

    print("== H. No sensitive fields in response ==")
    r = client.get("/api/profile", headers=ha)
    raw = json.dumps(r.json())
    check("no storage path leaked", "uploads" not in raw and "storage" not in raw.lower())
    summary = r.json()["profile"].get("professional_summary") or ""
    check("no raw resume text in summary", "Tier 2 technical support" not in summary)

    print(f"\n=== SMOKE RESULT: {PASS} passed, {FAIL} failed ===")
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()