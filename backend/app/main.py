"""CareerPilot API - FastAPI application."""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import health, jobs, ranked, applications, pipeline, demo, auth, dashboard, resume, profile, preferences, search, saved_jobs, portal_health, admin_sources, admin_users, public
from .store import invalidate_store_cache
from .demo_store import invalidate_demo_store_cache
from .services.search_manager import get_search_run_manager
from .services.llm_provider import get_llm_provider, set_provider
from .config import get_settings
from .security_headers import SecurityHeadersMiddleware

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: initialize LLM provider singleton
    try:
        get_llm_provider()
    except RuntimeError as e:
        # Log but don't crash — provider may not be needed for all endpoints
        import logging
        logging.getLogger(__name__).warning("LLM provider not initialized: %s", e)

    # Validate production configuration
    settings = get_settings()
    try:
        settings.validate_production_config()
    except ValueError as e:
        import logging
        logging.getLogger(__name__).critical("Production configuration validation failed: %s", e)
        raise

    yield
    # Shutdown: cleanup if needed
    pass


def create_app() -> FastAPI:
    """Build the CareerPilot API application for the current configuration.

    P3.2 production-surface hardening:
      * Interactive API documentation (/docs, /redoc) and the OpenAPI schema
        (/openapi.json) are registered only outside the production environment.
        In production they are not mounted at all, so the full API surface is
        never exposed to unauthenticated browsers. This is driven by the
        existing production configuration model (``settings.is_production``) —
        there is no runtime public/demo toggle.
      * A narrowly scoped security-headers middleware is registered; it adds
        browser-hardening headers to every HTTP response only in production.
    """
    settings = get_settings()
    production = settings.is_production

    api_app = FastAPI(
        title="CareerPilot API",
        description="Read-oriented API for CareerPilot job-search pipeline",
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/docs" if not production else None,
        redoc_url="/redoc" if not production else None,
        openapi_url="/openapi.json" if not production else None,
    )

    # CORS - configured via environment
    api_app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    # P3.2: production-only security headers (applied on top of CORS responses).
    api_app.add_middleware(SecurityHeadersMiddleware)

    # Include routers
    api_app.include_router(public.router)           # PUBLIC: demo data only (unauthenticated)
    api_app.include_router(health.router)           # PRIVATE: real data (authenticated)
    api_app.include_router(jobs.router)             # PRIVATE: real data (authenticated)
    api_app.include_router(ranked.router)           # PRIVATE: real data (authenticated)
    api_app.include_router(applications.router)     # PRIVATE: real data (authenticated)
    api_app.include_router(pipeline.router)         # PRIVATE: real data (authenticated)
    api_app.include_router(portal_health.router)    # PRIVATE: real data (authenticated)
    api_app.include_router(demo.router)             # INTERNAL: demo admin/bootstrap (unauthenticated, but gated by design)
    api_app.include_router(auth.router)             # PUBLIC: register/login/me
    api_app.include_router(dashboard.router)        # PRIVATE: real data (authenticated)
    api_app.include_router(resume.router)           # PRIVATE: real data (authenticated)
    api_app.include_router(profile.router)          # PRIVATE: real data (authenticated)
    api_app.include_router(preferences.router)      # PRIVATE: real data (authenticated)
    api_app.include_router(search.router)           # PRIVATE: real data (authenticated)
    api_app.include_router(saved_jobs.router)       # PRIVATE: real data (authenticated)
    api_app.include_router(admin_sources.router)    # ADMIN: real data (admin auth)
    api_app.include_router(admin_users.router)      # ADMIN: real data (admin auth)


    @api_app.on_event("startup")
    async def startup_event():
        """Initialize on startup. Reconcile stale search runs from prior process."""
        import logging
        logger = logging.getLogger(__name__)
        try:
            manager = get_search_run_manager()
            reconciled = await manager.reconcile_stale_runs()
            if reconciled:
                logger.info("Reconciled %d stale search run(s) on startup.", reconciled)
        except Exception:
            logger.exception("Startup reconciliation failed (non-fatal).")


    @api_app.on_event("shutdown")
    async def shutdown_event():
        """Cleanup on shutdown."""
        invalidate_store_cache()
        invalidate_demo_store_cache()


    @api_app.get("/")
    def root():
        """Root endpoint."""
        return {
            "name": "CareerPilot API",
            "version": "1.0.0",
            "docs": "/docs" if not production else None,
            "health": "/api/health",
        }

    return api_app


app = create_app()