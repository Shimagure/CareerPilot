import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProfile, useUpdateProfile, useExtractProfile } from '../hooks/useProfile';
import { useDashboard } from '../hooks/useDashboard';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { Textarea } from '../components/common/Textarea';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { EmptyState } from '../components/common/EmptyState';
import { LoadingSkeleton as Skeleton } from '../components/common/LoadingSkeleton';
import type { ProfileGetResponse, ProfileUpdateRequest, CandidateProfileResponse, ProfileExtractResponse } from '../api/types';

const PROVENANCE_LABELS: Record<'resume_extracted' | 'user_verified', string> = {
  resume_extracted: 'Extracted from resume',
  user_verified: 'Verified by you',
};

const PROVENANCE_COLORS: Record<'resume_extracted' | 'user_verified', string> = {
  resume_extracted: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  user_verified: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
};

const SECTIONS = [
  { key: 'full_name', label: 'Full Name', type: 'text' as const },
  { key: 'headline', label: 'Headline', type: 'text' as const },
  { key: 'location', label: 'Location', type: 'text' as const },
  { key: 'phone', label: 'Phone', type: 'tel' as const },
  { key: 'email', label: 'Email', type: 'email' as const },
  { key: 'linkedin_url', label: 'LinkedIn URL', type: 'url' as const },
  { key: 'portfolio_url', label: 'Portfolio URL', type: 'url' as const },
  { key: 'professional_summary', label: 'Professional Summary', type: 'textarea' as const },
] as const;

type SectionKey = typeof SECTIONS[number]['key'];

function ProvenanceBadge({ source }: { source: 'resume_extracted' | 'user_verified' }) {
  return (
    <Badge variant="default" className={PROVENANCE_COLORS[source]}>
      {PROVENANCE_LABELS[source]}
    </Badge>
  );
}

function FieldWithProvenance({
  value,
  source,
  label,
  type = 'text',
  onChange,
  disabled,
}: {
  value: string | undefined | null;
  source: 'resume_extracted' | 'user_verified';
  label: string;
  type?: 'text' | 'email' | 'tel' | 'url' | 'textarea';
  onChange?: (value: string) => void;
  disabled?: boolean;
}) {
  const displayValue = value || '';
  const isEmpty = !value;

  if (type === 'textarea') {
    return (
      <div className="w-full">
        <div className="flex items-center justify-between mb-1">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            {label}
          </label>
          {!isEmpty && <ProvenanceBadge source={source} />}
        </div>
        <Textarea
          value={displayValue}
          onChange={(e) => onChange?.(e.target.value)}
          disabled={disabled}
          rows={4}
          placeholder={isEmpty ? `No ${label.toLowerCase()} provided` : undefined}
          className={isEmpty ? 'text-gray-400 dark:text-gray-500' : ''}
        />
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-1">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </label>
        {!isEmpty && <ProvenanceBadge source={source} />}
      </div>
      <Input
        type={type}
        value={displayValue}
        onChange={(e) => onChange?.(e.target.value)}
        disabled={disabled}
        placeholder={isEmpty ? `No ${label.toLowerCase()} provided` : undefined}
        className={isEmpty ? 'text-gray-400 dark:text-gray-500' : ''}
      />
    </div>
  );
}

function ListField({
  items,
  label,
  renderItem,
  onAdd,
  onUpdate,
  onRemove,
  disabled,
}: {
  items: Array<{ source: 'resume_extracted' | 'user_verified'; [key: string]: any }>;
  label: string;
  renderItem: (item: any, index: number) => React.ReactNode;
  onAdd: () => void;
  onUpdate: (key: string, index: number, field: string, value: string) => void;
  onRemove: (key: string, index: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-3">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </label>
        {!disabled && (
          <Button variant="outline" size="sm" onClick={onAdd}>
            + Add
          </Button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-gray-400 dark:text-gray-500 text-sm italic">
          No {label.toLowerCase()} added yet
        </p>
      ) : (
        <div className="space-y-3">
          {items.map((item, index) => (
            <div
              key={index}
              className={`flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-lg border ${
                disabled ? 'bg-gray-50 dark:bg-gray-800' : 'bg-white dark:bg-gray-900'
              }`}
            >
              <div className="flex-1 min-w-0">{renderItem(item, index)}</div>
              <div className="flex items-center gap-2">
                <ProvenanceBadge source={item.source} />
                {!disabled && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-600 hover:text-red-700"
                    onClick={() => onRemove(label, index)}
                    aria-label={`Remove ${label.slice(0, -1)}`}
                  >
                    ✕
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SkillInput({ value, onChange, source, onRemove, index, disabled }: {
  value: string;
  onChange: (value: string) => void;
  source: 'resume_extracted' | 'user_verified';
  onRemove: () => void;
  index: number;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col sm:flex-row gap-2 w-full">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder="Skill name"
        className="flex-1"
      />
      <ProvenanceBadge source={source} />
      {!disabled && (
        <Button variant="ghost" size="sm" className="text-red-600" onClick={onRemove} aria-label="Remove skill">
          ✕
        </Button>
      )}
    </div>
  );
}

function ExperienceInput({ item, index, onUpdate, onRemove, disabled }: {
  item: any;
  index: number;
  onUpdate: (index: number, field: string, value: string) => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input
          value={item.employer || ''}
          onChange={(e) => onUpdate(index, 'employer', e.target.value)}
          disabled={disabled}
          placeholder="Employer"
        />
        <Input
          value={item.title || ''}
          onChange={(e) => onUpdate(index, 'title', e.target.value)}
          disabled={disabled}
          placeholder="Title"
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input
          value={item.start_date || ''}
          onChange={(e) => onUpdate(index, 'start_date', e.target.value)}
          disabled={disabled}
          placeholder="Start date (e.g., January 2020)"
        />
        <Input
          value={item.end_date || ''}
          onChange={(e) => onUpdate(index, 'end_date', e.target.value)}
          disabled={disabled}
          placeholder="End date (e.g., December 2022)"
        />
      </div>
      <Textarea
        value={item.description || ''}
        onChange={(e) => onUpdate(index, 'description', e.target.value)}
        disabled={disabled}
        placeholder="Description"
        rows={3}
      />
      {!disabled && (
        <div className="flex items-center justify-between">
          <ProvenanceBadge source={item.source} />
          <Button variant="ghost" size="sm" className="text-red-600" onClick={onRemove} aria-label="Remove experience">
            Remove
          </Button>
        </div>
      )}
    </div>
  );
}

function EducationInput({ item, index, onUpdate, onRemove, disabled }: {
  item: any;
  index: number;
  onUpdate: (index: number, field: string, value: string) => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input
          value={item.institution || ''}
          onChange={(e) => onUpdate(index, 'institution', e.target.value)}
          disabled={disabled}
          placeholder="Institution"
        />
        <Input
          value={item.degree || ''}
          onChange={(e) => onUpdate(index, 'degree', e.target.value)}
          disabled={disabled}
          placeholder="Degree"
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input
          value={item.field || ''}
          onChange={(e) => onUpdate(index, 'field', e.target.value)}
          disabled={disabled}
          placeholder="Field of study"
        />
        <Input
          value={item.start_date || ''}
          onChange={(e) => onUpdate(index, 'start_date', e.target.value)}
          disabled={disabled}
          placeholder="Start year"
        />
      </div>
      <Input
        value={item.end_date || ''}
        onChange={(e) => onUpdate(index, 'end_date', e.target.value)}
        disabled={disabled}
        placeholder="End year"
      />
      {!disabled && (
        <div className="flex items-center justify-between">
          <ProvenanceBadge source={item.source} />
          <Button variant="ghost" size="sm" className="text-red-600" onClick={onRemove} aria-label="Remove education">
            Remove
          </Button>
        </div>
      )}
    </div>
  );
}

function CertificationInput({ item, index, onUpdate, onRemove, disabled }: {
  item: any;
  index: number;
  onUpdate: (index: number, field: string, value: string) => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3">
      <Input
        value={item.name || ''}
        onChange={(e) => onUpdate(index, 'name', e.target.value)}
        disabled={disabled}
        placeholder="Certification name"
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input
          value={item.issuer || ''}
          onChange={(e) => onUpdate(index, 'issuer', e.target.value)}
          disabled={disabled}
          placeholder="Issuer"
        />
        <Input
          value={item.year || ''}
          onChange={(e) => onUpdate(index, 'year', e.target.value)}
          disabled={disabled}
          placeholder="Year (YYYY)"
        />
      </div>
      {!disabled && (
        <div className="flex items-center justify-between">
          <ProvenanceBadge source={item.source} />
          <Button variant="ghost" size="sm" className="text-red-600" onClick={onRemove} aria-label="Remove certification">
            Remove
          </Button>
        </div>
      )}
    </div>
  );
}

function LanguageInput({ item, index, onUpdate, onRemove, disabled }: {
  item: any;
  index: number;
  onUpdate: (index: number, field: string, value: string) => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Input
        value={item.name || ''}
        onChange={(e) => onUpdate(index, 'name', e.target.value)}
        disabled={disabled}
        placeholder="Language"
      />
      <Input
        value={item.level || ''}
        onChange={(e) => onUpdate(index, 'level', e.target.value)}
        disabled={disabled}
        placeholder="Level (e.g., Native, Professional)"
      />
      {!disabled && (
        <div className="flex items-center justify-between sm:col-span-2">
          <ProvenanceBadge source={item.source} />
          <Button variant="ghost" size="sm" className="text-red-600" onClick={onRemove} aria-label="Remove language">
            Remove
          </Button>
        </div>
      )}
    </div>
  );
}

function ProjectInput({ item, index, onUpdate, onRemove, disabled }: {
  item: any;
  index: number;
  onUpdate: (index: number, field: string, value: string) => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3">
      <Input
        value={item.name || ''}
        onChange={(e) => onUpdate(index, 'name', e.target.value)}
        disabled={disabled}
        placeholder="Project name"
      />
      <Textarea
        value={item.description || ''}
        onChange={(e) => onUpdate(index, 'description', e.target.value)}
        disabled={disabled}
        placeholder="Description"
        rows={3}
      />
      <Input
        value={item.url || ''}
        onChange={(e) => onUpdate(index, 'url', e.target.value)}
        disabled={disabled}
        placeholder="URL (optional)"
      />
      {!disabled && (
        <div className="flex items-center justify-between">
          <ProvenanceBadge source={item.source} />
          <Button variant="ghost" size="sm" className="text-red-600" onClick={onRemove} aria-label="Remove project">
            Remove
          </Button>
        </div>
      )}
    </div>
  );
}

export function ProfilePage() {
  const navigate = useNavigate();
  const { data: profileData, isLoading: profileLoading, error: profileError, refetch: refetchProfile } = useProfile();
  const { data: dashboardData } = useDashboard();
  const updateProfile = useUpdateProfile();
  const extractProfile = useExtractProfile();

  const [mode, setMode] = useState<'view' | 'edit' | 'review'>('view');
  const [draft, setDraft] = useState<CandidateProfileResponse | null>(null);
  const [extractWarning, setExtractWarning] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Determine if we should show empty state or redirect to edit
  const hasProfile = profileData?.profile !== null;
  const hasActiveResume = profileData?.has_active_resume || dashboardData?.profile_readiness.resume_uploaded;

  // If no profile exists and we have a resume, auto-show extract option
  useEffect(() => {
    if (!profileLoading && !hasProfile && hasActiveResume && mode === 'view') {
      setMode('review');
    }
  }, [profileLoading, hasProfile, hasActiveResume, mode]);

  const handleExtract = async () => {
    setIsExtracting(true);
    setExtractWarning(null);
    try {
      const response = await extractProfile.mutateAsync();
      setDraft(response.draft);
      if (response.warning) {
        setExtractWarning(response.warning);
      }
    } catch (err: any) {
      setExtractWarning(err.response?.data?.detail || 'Failed to extract profile from resume');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!draft) return;

    setErrors({});
    try {
      const payload: ProfileUpdateRequest = {
        full_name: draft.full_name,
        headline: draft.headline,
        location: draft.location,
        phone: draft.phone,
        email: draft.email,
        linkedin_url: draft.linkedin_url,
        portfolio_url: draft.portfolio_url,
        professional_summary: draft.professional_summary,
        skills: draft.skills.map(s => ({ name: s.name, source: 'user_verified' as const })),
        experience: draft.experience.map(e => ({ ...e, source: 'user_verified' as const })),
        education: draft.education.map(e => ({ ...e, source: 'user_verified' as const })),
        certifications: draft.certifications.map(c => ({ ...c, source: 'user_verified' as const })),
        languages: draft.languages.map(l => ({ ...l, source: 'user_verified' as const })),
        projects: draft.projects.map(p => ({ ...p, source: 'user_verified' as const })),
        source_resume_id: draft.source_resume_id,
      };

      await updateProfile.mutateAsync(payload);
      setDraft(null);
      setMode('view');
      setExtractWarning(null);
    } catch (err: any) {
      if (err.response?.data?.detail) {
        setErrors({ form: err.response.data.detail });
      } else {
        setErrors({ form: 'Failed to save profile' });
      }
    }
  };

  const handleSaveEdits = async (updatedProfile: CandidateProfileResponse) => {
    setErrors({});
    try {
      const payload: ProfileUpdateRequest = {
        full_name: updatedProfile.full_name,
        headline: updatedProfile.headline,
        location: updatedProfile.location,
        phone: updatedProfile.phone,
        email: updatedProfile.email,
        linkedin_url: updatedProfile.linkedin_url,
        portfolio_url: updatedProfile.portfolio_url,
        professional_summary: updatedProfile.professional_summary,
        skills: updatedProfile.skills.map(s => ({ ...s, source: 'user_verified' as const })),
        experience: updatedProfile.experience.map(e => ({ ...e, source: 'user_verified' as const })),
        education: updatedProfile.education.map(e => ({ ...e, source: 'user_verified' as const })),
        certifications: updatedProfile.certifications.map(c => ({ ...c, source: 'user_verified' as const })),
        languages: updatedProfile.languages.map(l => ({ ...l, source: 'user_verified' as const })),
        projects: updatedProfile.projects.map(p => ({ ...p, source: 'user_verified' as const })),
        source_resume_id: updatedProfile.source_resume_id,
      };

      await updateProfile.mutateAsync(payload);
      setMode('view');
    } catch (err: any) {
      if (err.response?.data?.detail) {
        setErrors({ form: err.response.data.detail });
      } else {
        setErrors({ form: 'Failed to save profile' });
      }
    }
  };

  if (profileLoading) {
    return (
      <div className="space-y-6">
        <Skeleton variant="rectangular" height="200" />
        <Skeleton variant="rectangular" height="200" />
        <Skeleton variant="rectangular" height="200" />
      </div>
    );
  }

  if (profileError) {
    return (
      <div className="text-center py-12">
        <EmptyState
          title="Failed to load profile"
          description="There was an error loading your profile. Please try again."
          action={{ label: 'Retry', onClick: () => refetchProfile() }}
        />
      </div>
    );
  }

  // If no profile and no resume, show empty state with CTA to upload resume
  if (!hasProfile && !hasActiveResume) {
    return (
      <div className="space-y-6">
        <Card>
          <div className="text-center py-12">
            <EmptyState
              title="No candidate profile yet"
              description="Upload your resume to automatically extract a candidate profile, or create one manually."
              action={{ label: 'Upload Resume', onClick: () => navigate('/resume') }}
            />
          </div>
        </Card>
      </div>
    );
  }

  // If no profile but has resume, show extract option
  if (!hasProfile && hasActiveResume && mode === 'view') {
    return (
      <div className="space-y-6">
        <Card>
          <div className="text-center py-12">
            <EmptyState
              title="No candidate profile yet"
              description="You have an uploaded resume. Extract your profile information from it to get started."
              action={{ label: 'Extract from Resume', onClick: handleExtract }}
            />
          </div>
        </Card>
        {extractWarning && (
          <Card className="border-amber-300 bg-amber-50 dark:bg-amber-900/20">
            <p className="text-amber-800 dark:text-amber-200">{extractWarning}</p>
          </Card>
        )}
      </div>
    );
  }

  // Review mode - showing extracted draft
  if (mode === 'review' && draft) {
    return (
      <div className="space-y-6 max-w-3xl mx-auto">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Review Extracted Profile</h1>
          <Button variant="ghost" onClick={() => { setMode('view'); setDraft(null); }}>
            Cancel
          </Button>
        </div>

        {extractWarning && (
          <Card className="border-amber-300 bg-amber-50 dark:bg-amber-900/20">
            <p className="text-amber-800 dark:text-amber-200">{extractWarning}</p>
          </Card>
        )}

        <Card>
          <div className="space-y-6">
            {SECTIONS.map((section) => {
              const value = draft[section.key as keyof CandidateProfileResponse] as string | undefined;
              // Simple fields don't have provenance in the draft - they come from resume extraction
              return value ? (
                <div key={section.key} className="pb-6 border-b last:border-0">
                  <FieldWithProvenance
                    value={value}
                    source="resume_extracted"
                    label={section.label}
                    type={section.type}
                    disabled
                  />
                </div>
              ) : null;
            })}

            {draft.skills.length > 0 && (
              <div className="pb-6 border-b">
                <div className="flex items-center justify-between mb-3">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Skills</label>
                  <span className="text-sm text-gray-500">{draft.skills.length} skills</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {draft.skills.map((skill, i) => (
                    <Badge key={i} variant="default" className={PROVENANCE_COLORS[skill.source]}>
                      {skill.name} <ProvenanceBadge source={skill.source} />
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {draft.experience.length > 0 && (
              <div className="pb-6 border-b">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Experience</label>
                <div className="space-y-4">
                  {draft.experience.map((exp, i) => (
                    <div key={i} className="p-4 rounded-lg border bg-gray-50 dark:bg-gray-800">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium">{exp.employer || 'Unknown employer'}</span>
                        <ProvenanceBadge source={exp.source} />
                      </div>
                      {exp.title && <p className="text-gray-600 dark:text-gray-300">{exp.title}</p>}
                      <div className="flex flex-wrap gap-4 text-sm text-gray-500 mt-2">
                        {exp.start_date && <span>{exp.start_date}</span>}
                        {exp.end_date && <span>– {exp.end_date}</span>}
                      </div>
                      {exp.description && <p className="mt-2 text-gray-600 dark:text-gray-300">{exp.description}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {draft.education.length > 0 && (
              <div className="pb-6 border-b">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Education</label>
                <div className="space-y-3">
                  {draft.education.map((edu, i) => (
                    <div key={i} className="p-3 rounded-lg border bg-gray-50 dark:bg-gray-800 flex items-center justify-between">
                      <div>
                        {edu.institution && <p className="font-medium">{edu.institution}</p>}
                        {edu.degree && <p className="text-gray-600 dark:text-gray-300">{edu.degree}</p>}
                        {edu.field && <p className="text-sm text-gray-500">{edu.field}</p>}
                        <div className="flex flex-wrap gap-4 text-sm text-gray-500 mt-1">
                          {edu.start_date && <span>{edu.start_date}</span>}
                          {edu.end_date && <span>– {edu.end_date}</span>}
                        </div>
                      </div>
                      <ProvenanceBadge source={edu.source} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {draft.certifications.length > 0 && (
              <div className="pb-6 border-b">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Certifications</label>
                <div className="space-y-2">
                  {draft.certifications.map((cert, i) => (
                    <div key={i} className="p-3 rounded-lg border bg-gray-50 dark:bg-gray-800 flex items-center justify-between">
                      <div>
                        <p className="font-medium">{cert.name}</p>
                        {cert.issuer && <p className="text-sm text-gray-500">{cert.issuer}</p>}
                        {cert.year && <p className="text-sm text-gray-500">{cert.year}</p>}
                      </div>
                      <ProvenanceBadge source={cert.source} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {draft.languages.length > 0 && (
              <div className="pb-6 border-b">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Languages</label>
                <div className="flex flex-wrap gap-2">
                  {draft.languages.map((lang, i) => (
                    <Badge key={i} variant="default" className={PROVENANCE_COLORS[lang.source]}>
                      {lang.name} {lang.level ? `(${lang.level})` : ''}
                      <ProvenanceBadge source={lang.source} />
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {draft.projects.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Projects</label>
                <div className="space-y-3">
                  {draft.projects.map((proj, i) => (
                    <div key={i} className="p-3 rounded-lg border bg-gray-50 dark:bg-gray-800 flex items-center justify-between">
                      <div>
                        <p className="font-medium">{proj.name}</p>
                        {proj.description && <p className="text-sm text-gray-500">{proj.description}</p>}
                        {proj.url && <a href={proj.url} target="_blank" rel="noopener noreferrer" className="text-sm text-brand-600 hover:underline mt-1 inline-block">{proj.url}</a>}
                      </div>
                      <ProvenanceBadge source={proj.source} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => { setMode('edit'); }}>
            Edit before saving
          </Button>
          <Button onClick={handleSaveDraft} loading={updateProfile.isPending}>
            Save Profile
          </Button>
        </div>

        {errors.form && (
          <Card className="border-red-300 bg-red-50 dark:bg-red-900/20">
            <p className="text-red-800 dark:text-red-200">{errors.form}</p>
          </Card>
        )}
      </div>
    );
  }

  // Edit mode
  if (mode === 'edit') {
    const profile = profileData!.profile!;
    const [editData, setEditData] = useState<CandidateProfileResponse>(profile);

    const updateField = useCallback((key: SectionKey, value: string) => {
      setEditData(prev => ({ ...prev, [key]: value }));
    }, []);

    const updateListField = useCallback((
      key: keyof CandidateProfileResponse,
      index: number,
      field: string,
      value: string
    ) => {
      setEditData(prev => {
        const currentList = (prev[key] as any[]) || [];
        const newList = [...currentList];
        newList[index] = { ...newList[index], [field]: value };
        return { ...prev, [key]: newList };
      });
    }, []);

    const addItem = useCallback((key: string, newItem: any) => {
      setEditData(prev => ({
        ...prev,
        [key]: [...(prev[key as keyof CandidateProfileResponse] as any[] || []), newItem]
      }));
    }, []);

    const removeItem = useCallback((key: string, index: number) => {
      setEditData(prev => {
        const list = [...(prev[key as keyof CandidateProfileResponse] as any[] || [])];
        list.splice(index, 1);
        return { ...prev, [key]: list };
      });
    }, []);

    return (
      <div className="space-y-6 max-w-3xl mx-auto">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Edit Profile</h1>
          <Button variant="ghost" onClick={() => { setMode('view'); setErrors({}); }}>
            Cancel
          </Button>
        </div>

        <Card>
          <form onSubmit={(e) => { e.preventDefault(); handleSaveEdits(editData); }} className="space-y-6">
            {SECTIONS.map((section) => (
              <div key={section.key}>
                <FieldWithProvenance
                  value={editData[section.key as keyof CandidateProfileResponse] as string | undefined}
                  source="user_verified"
                  label={section.label}
                  type={section.type}
                  onChange={(value) => updateField(section.key, value)}
                  disabled={false}
                />
              </div>
            ))}

            <div>
              <ListField
                items={editData.skills}
                label="Skills"
                renderItem={(skill, index) => (
                  <SkillInput
                    value={skill.name}
                    onChange={(value) => updateListField('skills', index, 'name', value)}
                    source={skill.source}
                    onRemove={() => removeItem('skills', index)}
                    index={index}
                  />
                )}
                onAdd={() => addItem('skills', { name: '', source: 'user_verified' })}
                onUpdate={(key, index, field, value) => updateListField(key as keyof CandidateProfileResponse, index, field, value)}
                onRemove={removeItem}
              />
            </div>

            <div>
              <ListField
                items={editData.experience}
                label="Experience"
                renderItem={(item, index) => (
                  <ExperienceInput
                    item={item}
                    index={index}
                    onUpdate={(idx, field, value) => updateListField('experience', idx, field, value)}
                    onRemove={() => removeItem('experience', index)}
                    disabled={false}
                  />
                )}
                onAdd={() => addItem('experience', { employer: '', title: '', start_date: '', end_date: '', description: '', source: 'user_verified' })}
                onUpdate={(key, index, field, value) => updateListField(key as keyof CandidateProfileResponse, index, field, value)}
                onRemove={removeItem}
              />
            </div>

            <div>
              <ListField
                items={editData.education}
                label="Education"
                renderItem={(item, index) => (
                  <EducationInput
                    item={item}
                    index={index}
                    onUpdate={(idx, field, value) => updateListField('education', idx, field, value)}
                    onRemove={() => removeItem('education', index)}
                    disabled={false}
                  />
                )}
                onAdd={() => addItem('education', { institution: '', degree: '', field: '', start_date: '', end_date: '', source: 'user_verified' })}
                onUpdate={(key, index, field, value) => updateListField(key as keyof CandidateProfileResponse, index, field, value)}
                onRemove={removeItem}
              />
            </div>

            <div>
              <ListField
                items={editData.certifications}
                label="Certifications"
                renderItem={(item, index) => (
                  <CertificationInput
                    item={item}
                    index={index}
                    onUpdate={(idx, field, value) => updateListField('certifications', idx, field, value)}
                    onRemove={() => removeItem('certifications', index)}
                    disabled={false}
                  />
                )}
                onAdd={() => addItem('certifications', { name: '', issuer: '', year: '', source: 'user_verified' })}
                onUpdate={(key, index, field, value) => updateListField(key as keyof CandidateProfileResponse, index, field, value)}
                onRemove={removeItem}
              />
            </div>

            <div>
              <ListField
                items={editData.languages}
                label="Languages"
                renderItem={(item, index) => (
                  <LanguageInput
                    item={item}
                    index={index}
                    onUpdate={(idx, field, value) => updateListField('languages', idx, field, value)}
                    onRemove={() => removeItem('languages', index)}
                    disabled={false}
                  />
                )}
                onAdd={() => addItem('languages', { name: '', level: '', source: 'user_verified' })}
                onUpdate={(key, index, field, value) => updateListField(key as keyof CandidateProfileResponse, index, field, value)}
                onRemove={removeItem}
              />
            </div>

            <div>
              <ListField
                items={editData.projects}
                label="Projects"
                renderItem={(item, index) => (
                  <ProjectInput
                    item={item}
                    index={index}
                    onUpdate={(idx, field, value) => updateListField('projects', idx, field, value)}
                    onRemove={() => removeItem('projects', index)}
                    disabled={false}
                  />
                )}
                onAdd={() => addItem('projects', { name: '', description: '', url: '', source: 'user_verified' })}
                onUpdate={(key, index, field, value) => updateListField(key as keyof CandidateProfileResponse, index, field, value)}
                onRemove={removeItem}
              />
            </div>

            {errors.form && (
              <div className="p-3 rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200">
                {errors.form}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => { setMode('view'); setErrors({}); }}>
                Cancel
              </Button>
              <Button type="submit" loading={updateProfile.isPending}>
                Save Changes
              </Button>
            </div>
          </form>
        </Card>
      </div>
    );
  }

  // View mode - show existing profile
  const profile = profileData!.profile!;

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Candidate Profile</h1>
        <div className="flex gap-2">
          {hasActiveResume && (
            <Button variant="outline" onClick={handleExtract} loading={isExtracting}>
              Re-extract from Resume
            </Button>
          )}
          <Button variant="outline" onClick={() => setMode('edit')}>
            Edit Profile
          </Button>
        </div>
      </div>

      {extractWarning && (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-900/20">
          <p className="text-amber-800 dark:text-amber-200">{extractWarning}</p>
        </Card>
      )}

      <Card>
        <div className="space-y-6">
          {SECTIONS.map((section) => {
            const value = profile[section.key as keyof CandidateProfileResponse] as string | undefined;
            // Simple fields don't have provenance in the profile - use user_verified since they were manually entered
            return (
              <div key={section.key} className="pb-6 border-b last:border-0">
                <FieldWithProvenance
                  value={value}
                  source="user_verified"
                  label={section.label}
                  type={section.type}
                  disabled
                />
              </div>
            );
          })}

          {profile.skills.length > 0 && (
            <div className="pb-6 border-b">
              <div className="flex items-center justify-between mb-3">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Skills</label>
                <span className="text-sm text-gray-500">{profile.skills.length} skills</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {profile.skills.map((skill, i) => (
                  <Badge key={i} variant="default" className={PROVENANCE_COLORS[skill.source]}>
                    {skill.name} <ProvenanceBadge source={skill.source} />
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {profile.experience.length > 0 && (
            <div className="pb-6 border-b">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Experience</label>
              <div className="space-y-4">
                {profile.experience.map((exp, i) => (
                  <div key={i} className="p-4 rounded-lg border bg-gray-50 dark:bg-gray-800">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium">{exp.employer || 'Unknown employer'}</span>
                      <ProvenanceBadge source={exp.source} />
                    </div>
                    {exp.title && <p className="text-gray-600 dark:text-gray-300">{exp.title}</p>}
                    <div className="flex flex-wrap gap-4 text-sm text-gray-500 mt-2">
                      {exp.start_date && <span>{exp.start_date}</span>}
                      {exp.end_date && <span>– {exp.end_date}</span>}
                    </div>
                    {exp.description && <p className="mt-2 text-gray-600 dark:text-gray-300">{exp.description}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {profile.education.length > 0 && (
            <div className="pb-6 border-b">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Education</label>
              <div className="space-y-3">
                {profile.education.map((edu, i) => (
                  <div key={i} className="p-3 rounded-lg border bg-gray-50 dark:bg-gray-800 flex items-center justify-between">
                    <div>
                      {edu.institution && <p className="font-medium">{edu.institution}</p>}
                      {edu.degree && <p className="text-gray-600 dark:text-gray-300">{edu.degree}</p>}
                      {edu.field && <p className="text-sm text-gray-500">{edu.field}</p>}
                      <div className="flex flex-wrap gap-4 text-sm text-gray-500 mt-1">
                        {edu.start_date && <span>{edu.start_date}</span>}
                        {edu.end_date && <span>– {edu.end_date}</span>}
                      </div>
                    </div>
                    <ProvenanceBadge source={edu.source} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {profile.certifications.length > 0 && (
            <div className="pb-6 border-b">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Certifications</label>
              <div className="space-y-2">
                {profile.certifications.map((cert, i) => (
                  <div key={i} className="p-3 rounded-lg border bg-gray-50 dark:bg-gray-800 flex items-center justify-between">
                    <div>
                      <p className="font-medium">{cert.name}</p>
                      {cert.issuer && <p className="text-sm text-gray-500">{cert.issuer}</p>}
                      {cert.year && <p className="text-sm text-gray-500">{cert.year}</p>}
                    </div>
                    <ProvenanceBadge source={cert.source} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {profile.languages.length > 0 && (
            <div className="pb-6 border-b">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Languages</label>
              <div className="flex flex-wrap gap-2">
                {profile.languages.map((lang, i) => (
                  <Badge key={i} variant="default" className={PROVENANCE_COLORS[lang.source]}>
                    {lang.name} {lang.level ? `(${lang.level})` : ''}
                    <ProvenanceBadge source={lang.source} />
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {profile.projects.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Projects</label>
              <div className="space-y-3">
                {profile.projects.map((proj, i) => (
                  <div key={i} className="p-3 rounded-lg border bg-gray-50 dark:bg-gray-800 flex items-center justify-between">
                    <div>
                      <p className="font-medium">{proj.name}</p>
                      {proj.description && <p className="text-sm text-gray-500">{proj.description}</p>}
                      {proj.url && <a href={proj.url} target="_blank" rel="noopener noreferrer" className="text-sm text-brand-600 hover:underline mt-1 inline-block">{proj.url}</a>}
                    </div>
                    <ProvenanceBadge source={proj.source} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {(profile.skills.length === 0 &&
            profile.experience.length === 0 &&
            profile.education.length === 0 &&
            profile.certifications.length === 0 &&
            profile.languages.length === 0 &&
            profile.projects.length === 0 &&
            !profile.full_name &&
            !profile.headline &&
            !profile.location &&
            !profile.phone &&
            !profile.email &&
            !profile.linkedin_url &&
            !profile.portfolio_url &&
            !profile.professional_summary) && (
            <div className="text-center py-8">
              <EmptyState
                title="Profile is empty"
                description="No profile information has been added yet. Extract from your resume or add details manually."
                action={{ label: 'Edit Profile', onClick: () => setMode('edit') }}
              />
            </div>
          )}
        </div>
      </Card>

      {profile.source_resume_filename && (
        <Card className="bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800">
          <p className="text-sm text-blue-800 dark:text-blue-200">
            <strong>Source:</strong> This profile was originally extracted from <strong>{profile.source_resume_filename}</strong>
            {profile.manually_edited && ' and has been manually edited since.'}
          </p>
        </Card>
      )}
    </div>
  );
}

export { ProfilePage as Profile };