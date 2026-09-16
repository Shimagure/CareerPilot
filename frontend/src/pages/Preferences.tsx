import { useState, useEffect, useCallback } from 'react';
import { usePreferences, useUpdatePreferences } from '../hooks/usePreferences';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { Skeleton } from '../components/common/LoadingSkeleton';
import { ErrorState } from '../components/common/ErrorState';
import { getApiErrorMessage } from '../utils/errors';
import type {
  SearchPreferencesResponse,
  SearchPreferencesUpdateRequest,
  PreferenceWorkArrangement,
  SalaryPeriod,
} from '../api/types';

const MAX_CHIP_INPUT = 50;
const MAX_CHIP_LENGTH = 200;

const CURRENCIES = ['PHP', 'USD', 'EUR', 'GBP', 'SGD', 'AUD', 'CAD'] as const;

const WORK_ARRANGEMENTS: Array<{ value: PreferenceWorkArrangement; label: string; description: string }> = [
  { value: 'remote', label: 'Remote', description: 'Work from anywhere' },
  { value: 'hybrid', label: 'Hybrid', description: 'Partial office + remote' },
  { value: 'onsite', label: 'On-site', description: 'Fully in office' },
];

const SALARY_PERIODS: Array<{ value: SalaryPeriod; label: string }> = [
  { value: 'monthly', label: 'Per month' },
  { value: 'annual', label: 'Per year' },
];

export function Preferences() {
  const { data, isLoading, isError, error, refetch } = usePreferences();
  const updatePreferences = useUpdatePreferences();
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const pref: SearchPreferencesResponse | null = data?.preferences ?? null;

  const [targetRoles, setTargetRoles] = useState<string[]>([]);
  const [excludedKeywords, setExcludedKeywords] = useState<string[]>([]);
  const [preferredLocations, setPreferredLocations] = useState<string[]>([]);
  const [workArrangements, setWorkArrangements] = useState<PreferenceWorkArrangement[]>([]);
  const [salaryMin, setSalaryMin] = useState<string>('');
  const [salaryMax, setSalaryMax] = useState<string>('');
  const [salaryCurrency, setSalaryCurrency] = useState<string>('PHP');
  const [salaryPeriod, setSalaryPeriod] = useState<SalaryPeriod>('monthly');
  const [dayShiftOk, setDayShiftOk] = useState<boolean>(true);
  const [nightShiftOk, setNightShiftOk] = useState<boolean>(true);
  const [rotationalOk, setRotationalOk] = useState<boolean>(true);
  const [ncrOnly, setNcrOnly] = useState<boolean>(false);
  const [careerDirection, setCareerDirection] = useState<string>('');

  useEffect(() => {
    if (pref) {
      setTargetRoles(pref.target_roles);
      setExcludedKeywords(pref.excluded_keywords);
      setPreferredLocations(pref.preferred_locations);
      setWorkArrangements(pref.work_arrangements);
      setSalaryMin(pref.salary_min !== null ? String(pref.salary_min) : '');
      setSalaryMax(pref.salary_max !== null ? String(pref.salary_max) : '');
      setSalaryCurrency(pref.salary_currency || 'PHP');
      setSalaryPeriod(pref.salary_period || 'monthly');
      setDayShiftOk(pref.day_shift_ok);
      setNightShiftOk(pref.night_shift_ok);
      setRotationalOk(pref.rotational_ok);
      setNcrOnly(pref.ncr_only);
      setCareerDirection(pref.career_direction || '');
    }
  }, [pref]);

  const validate = useCallback((): boolean => {
    const errs: Record<string, string> = {};

    for (const list of [
      { name: 'target_roles', items: targetRoles },
      { name: 'preferred_locations', items: preferredLocations },
      { name: 'excluded_keywords', items: excludedKeywords },
    ]) {
      if (list.items.length > MAX_CHIP_INPUT) {
        errs[list.name] = `Maximum ${MAX_CHIP_INPUT} items allowed`;
      }
      for (const item of list.items) {
        if (item.length > MAX_CHIP_LENGTH) {
          errs[list.name] = `Each item must be at most ${MAX_CHIP_LENGTH} characters`;
          break;
        }
      }
    }

    const min = salaryMin !== '' ? Number(salaryMin) : null;
    const max = salaryMax !== '' ? Number(salaryMax) : null;
    if (min !== null && (isNaN(min) || min < 0)) errs.salary_min = 'Must be a non-negative number';
    if (max !== null && (isNaN(max) || max < 0)) errs.salary_max = 'Must be a non-negative number';
    if (min !== null && max !== null && min > max) errs.salary_max = 'Maximum must be greater than or equal to minimum';
    if (salaryCurrency.length < 3 || salaryCurrency.length > 10 || !/^[A-Za-z]+$/.test(salaryCurrency)) errs.salary_currency = 'Must be 3-10 letters (e.g. PHP)';
    if (careerDirection.length > 2000) errs.career_direction = 'Must be at most 2,000 characters';

    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  }, [targetRoles, preferredLocations, excludedKeywords, salaryMin, salaryMax, salaryCurrency, careerDirection]);

  const handleSave = useCallback(async () => {
    if (!validate()) return;
    setSuccessMessage(null);
    setFormErrors({});

    const payload: SearchPreferencesUpdateRequest = {
      target_roles: targetRoles,
      excluded_keywords: excludedKeywords,
      preferred_locations: preferredLocations,
      work_arrangements: workArrangements,
      salary_min: salaryMin !== '' ? Number(salaryMin) : null,
      salary_max: salaryMax !== '' ? Number(salaryMax) : null,
      salary_currency: salaryCurrency.toUpperCase(),
      salary_period: salaryPeriod,
      day_shift_ok: dayShiftOk,
      night_shift_ok: nightShiftOk,
      rotational_ok: rotationalOk,
      ncr_only: ncrOnly,
      career_direction: careerDirection.trim() || null,
    };

    try {
      await updatePreferences.mutateAsync(payload);
      setSuccessMessage('Preferences saved.');
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: unknown) {
      setFormErrors({ _submit: getApiErrorMessage(err, 'Failed to save preferences.') });
    }
  }, [validate, targetRoles, excludedKeywords, preferredLocations, workArrangements, salaryMin, salaryMax, salaryCurrency, salaryPeriod, dayShiftOk, nightShiftOk, rotationalOk, ncrOnly, careerDirection, updatePreferences]);

  if (isLoading) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading search preferences">
        <Skeleton variant="text" width="50%" height={28} />
        <Skeleton variant="rectangular" height={320} width="100%" />
        <Skeleton variant="rectangular" height={200} width="100%" />
      </div>
    );
  }

  if (isError) {
    return (
      <ErrorState
        title="Couldn't load your search preferences"
        message={error instanceof Error ? error.message : 'Something went wrong.'}
        onRetry={refetch}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Search Preferences</h1>
        <p className="page-subtitle">
          These preferences tell CareerPilot what you're looking for. They will be used by future job-matching workflows.
        </p>
      </div>

      {!pref?.configured && (
        <div className="rounded-2xl border border-cyan-500/[0.25] bg-cyan-500/[0.07] p-4 text-sm text-cyan-300" role="status">
          Your search preferences aren't configured yet. Fill in the fields below and save to complete this step.
        </div>
      )}

      {formErrors._submit && (
        <div className="rounded-xl border border-red-500/[0.3] bg-red-500/[0.08] px-4 py-3 text-sm text-red-300" role="alert">
          {formErrors._submit}
        </div>
      )}

      {successMessage && (
        <div className="rounded-xl border border-emerald-500/[0.3] bg-emerald-500/[0.08] px-4 py-3 text-sm text-emerald-300" role="status">
          {successMessage}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Target Roles</CardTitle>
          <CardDescription>The job titles you're looking for (e.g. "IT Support Specialist", "Systems Administrator").</CardDescription>
        </CardHeader>
        <CardContent>
          <ChipInput value={targetRoles} onChange={setTargetRoles} placeholder="Type a role and press Enter" error={formErrors.target_roles} ariaLabel="Target roles" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preferred Locations</CardTitle>
          <CardDescription>Where you'd like to work (e.g. "Metro Manila", "Remote"). This is distinct from work arrangement.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChipInput value={preferredLocations} onChange={setPreferredLocations} placeholder="Type a location and press Enter" error={formErrors.preferred_locations} ariaLabel="Preferred locations" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Excluded Keywords</CardTitle>
          <CardDescription>Job titles or descriptions containing these words will be deprioritized (e.g. "Sales", "BPO voice").</CardDescription>
        </CardHeader>
        <CardContent>
          <ChipInput value={excludedKeywords} onChange={setExcludedKeywords} placeholder="Type a keyword and press Enter" error={formErrors.excluded_keywords} ariaLabel="Excluded keywords" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Work Arrangement</CardTitle>
          <CardDescription>Select every arrangement you're open to. Unselected options will not be assumed.</CardDescription>
        </CardHeader>
        <CardContent>
          <fieldset>
            <legend className="sr-only">Work arrangement</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {WORK_ARRANGEMENTS.map((arr) => {
                const checked = workArrangements.includes(arr.value);
                return (
                  <label
                    key={arr.value}
                    className={`flex flex-col items-center gap-2 p-4 rounded-2xl border cursor-pointer transition-colors ${
                      checked
                        ? 'border-brand-500/[0.4] bg-brand-500/[0.1]'
                        : 'border-white/[0.07] bg-white/[0.02] hover:border-white/[0.15]'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => setWorkArrangements((prev) => checked ? prev.filter((v) => v !== arr.value) : [...prev, arr.value])}
                      className="h-4 w-4 rounded border-white/[0.2] bg-white/[0.06] text-brand-500 focus:ring-brand-500"
                    />
                    <span className="text-sm font-medium text-slate-200">{arr.label}</span>
                    <span className="text-xs text-slate-400 text-center">{arr.description}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Salary Expectations</CardTitle>
          <CardDescription>Your target salary range. Leave blank if open to anything.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-4">
            <div>
              <label htmlFor="salary_min" className="label">Minimum</label>
              <input
                id="salary_min"
                type="number"
                min={0}
                step={1000}
                value={salaryMin}
                onChange={(e) => setSalaryMin(e.target.value)}
                placeholder="e.g. 30000"
                aria-invalid={!!formErrors.salary_min}
                aria-describedby={formErrors.salary_min ? 'salary_min-error' : undefined}
                className="input"
              />
              {formErrors.salary_min && (
                <p id="salary_min-error" className="mt-1 text-sm text-red-400" role="alert">{formErrors.salary_min}</p>
              )}
            </div>
            <div>
              <label htmlFor="salary_max" className="label">Maximum</label>
              <input
                id="salary_max"
                type="number"
                min={0}
                step={1000}
                value={salaryMax}
                onChange={(e) => setSalaryMax(e.target.value)}
                placeholder="e.g. 45000"
                aria-invalid={!!formErrors.salary_max}
                aria-describedby={formErrors.salary_max ? 'salary_max-error' : undefined}
                className="input"
              />
              {formErrors.salary_max && (
                <p id="salary_max-error" className="mt-1 text-sm text-red-400" role="alert">{formErrors.salary_max}</p>
              )}
            </div>
            <div>
              <label htmlFor="salary_currency" className="label">Currency</label>
              <select
                id="salary_currency"
                value={salaryCurrency}
                onChange={(e) => setSalaryCurrency(e.target.value)}
                aria-invalid={!!formErrors.salary_currency}
                aria-describedby={formErrors.salary_currency ? 'salary_currency-error' : undefined}
                className="select"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              {formErrors.salary_currency && (
                <p id="salary_currency-error" className="mt-1 text-sm text-red-400" role="alert">{formErrors.salary_currency}</p>
              )}
            </div>
            <div>
              <label htmlFor="salary_period" className="label">Pay period</label>
              <select
                id="salary_period"
                value={salaryPeriod}
                onChange={(e) => setSalaryPeriod(e.target.value as SalaryPeriod)}
                className="select"
              >
                {SALARY_PERIODS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Shift &amp; Location Preferences</CardTitle>
          <CardDescription>Additional availability preferences.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4">
            {[
              { label: 'Day shift', checked: dayShiftOk, onChange: () => setDayShiftOk(!dayShiftOk) },
              { label: 'Night shift', checked: nightShiftOk, onChange: () => setNightShiftOk(!nightShiftOk) },
              { label: 'Rotational shifts', checked: rotationalOk, onChange: () => setRotationalOk(!rotationalOk) },
              { label: 'NCR/Metro Manila only (for onsite/hybrid)', checked: ncrOnly, onChange: () => setNcrOnly(!ncrOnly) },
            ].map((opt) => (
              <label key={opt.label} className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={opt.checked}
                  onChange={opt.onChange}
                  className="h-4 w-4 rounded border-white/[0.2] bg-white/[0.06] text-brand-500 focus:ring-brand-500"
                />
                <span className="text-sm text-slate-200">{opt.label}</span>
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Career Direction</CardTitle>
          <CardDescription>Describe where you'd like your career to go (optional, max 2,000 characters).</CardDescription>
        </CardHeader>
        <CardContent>
          <textarea
            value={careerDirection}
            onChange={(e) => setCareerDirection(e.target.value)}
            placeholder="e.g. Move toward systems and cloud administration..."
            rows={3}
            maxLength={2000}
            aria-invalid={!!formErrors.career_direction}
            aria-describedby={formErrors.career_direction ? 'career-direction-error' : undefined}
            className="input resize-y min-h-[80px]"
          />
          <div className="flex justify-between mt-1">
            {formErrors.career_direction && (
              <p id="career-direction-error" className="text-sm text-red-400" role="alert">{formErrors.career_direction}</p>
            )}
            <span className="text-xs text-slate-500 ml-auto">{careerDirection.length}/2000</span>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end pb-8">
        <Button onClick={handleSave} disabled={updatePreferences.isPending}>
          {updatePreferences.isPending ? 'Saving...' : 'Save preferences'}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Chip input (multi-value string list)                               */
/* ------------------------------------------------------------------ */

function ChipInput({
  value,
  onChange,
  placeholder,
  error,
  ariaLabel,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  error?: string;
  ariaLabel: string;
}) {
  const [input, setInput] = useState('');

  const addItem = () => {
    const text = input.trim();
    if (!text || value.includes(text) || value.length >= MAX_CHIP_INPUT || text.length > MAX_CHIP_LENGTH) {
      setInput('');
      return;
    }
    onChange([...value, text]);
    setInput('');
  };

  const removeItem = (item: string) => onChange(value.filter((v) => v !== item));

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); addItem(); }
    if (e.key === 'Backspace' && input === '' && value.length > 0) removeItem(value[value.length - 1]);
  };

  return (
    <div>
      <div
        className={`flex flex-wrap gap-2 p-2.5 rounded-xl border min-h-[42px] focus-within:ring-2 focus-within:ring-brand-500 focus-within:border-transparent bg-white/[0.03] ${
          error ? 'border-red-500/[0.5] focus-within:ring-red-500' : 'border-white/[0.1]'
        }`}
      >
        {value.map((item) => (
          <span
            key={item}
            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border border-brand-500/[0.3] bg-brand-500/[0.1] text-brand-200 text-sm"
          >
            {item}
            <button
              type="button"
              onClick={() => removeItem(item)}
              className="text-brand-400 hover:text-brand-200"
              aria-label={`Remove ${item}`}
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </span>
        ))}
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={addItem}
          placeholder={value.length === 0 ? placeholder : ''}
          aria-label={ariaLabel}
          className="flex-1 min-w-[120px] bg-transparent text-sm focus:outline-none text-slate-200 placeholder-slate-500"
        />
      </div>
      {error && (
        <p className="mt-1 text-sm text-red-400" role="alert">{error}</p>
      )}
    </div>
  );
}