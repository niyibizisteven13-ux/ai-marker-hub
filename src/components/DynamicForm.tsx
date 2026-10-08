import React, { useMemo, useState } from 'react';

type FormField = {
  id: string;
  type: string;
  label: string;
  description?: string;
  required?: boolean;
  points?: number;
  correctAnswer?: string;
  options?: Array<string | { label: string }>;
  rows?: string[];
  sectionTitle?: string;
  contentTitle?: string;
  imageUrl?: string;
  videoUrl?: string;
  videoDataUrl?: string;
  columns?: string[];
  scaleMin?: number;
  scaleMax?: number;
  scaleMinLabel?: string;
  scaleMaxLabel?: string;
  maxRating?: number;
};

type FormSchema = {
  id?: string;
  title?: string;
  description?: string;
  descriptionImageUrl?: string;
  fields?: FormField[];
  questions?: any[];
  blocks?: any[];
  themeColor?: string;
  isQuiz?: boolean;
  collectEmail?: boolean;
  acceptingResponses?: boolean;
  allowMultipleResponses?: boolean;
  confirmationMessage?: string;
};

const normalizeType = (type: string) => ({
  SHORT_TEXT: 'text', LONG_TEXT: 'long_text', MULTIPLE_CHOICE: 'radio', CHECKBOX: 'checkbox',
  DROPDOWN: 'select', DATE: 'date', NUMBER: 'number', EMAIL: 'email', PHONE: 'tel', URL: 'url',
  FILE_UPLOAD: 'file', RATING: 'rating', LINEAR_SCALE: 'linear_scale', MULTIPLE_CHOICE_GRID: 'radio_grid',
  CHECKBOX_GRID: 'checkbox_grid', TIME: 'time',
} as Record<string, string>)[type] || (type === 'mcq' ? 'select' : type === 'essay' ? 'long_text' : type);

export default function DynamicForm({
  schema,
  onSubmit,
}: {
  schema: string | any;
  onSubmit: (data: any) => void | Promise<any>;
}) {
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{
    message: string;
    score?: number | null;
    feedback?: string | null;
  } | null>(null);

  const parsedSchema = useMemo<FormSchema | null>(() => {
    if (!schema) return null;
    let obj: any = schema;
    if (typeof obj === 'string') {
      try { obj = JSON.parse(obj); }
      catch (error) { console.error('DynamicForm: Failed to parse schema string', error); return null; }
    }
    if (obj && typeof obj === 'object' && obj.schema && !Array.isArray(obj.questions) && !Array.isArray(obj.fields)) {
      let inner = obj.schema;
      if (typeof inner === 'string') {
        try { inner = JSON.parse(inner); } catch { inner = {}; }
      }
      if (inner && typeof inner === 'object') {
        obj = { ...obj, ...inner };
      }
    }
    return obj;
  }, [schema]);

  const fields: FormField[] = useMemo(() => {
    if (Array.isArray(parsedSchema?.fields)) return parsedSchema.fields.map((field: any, index) => ({
      ...field,
      id: String(field.id ?? index + 1),
      label: field.label || field.title || `Question ${index + 1}`,
      type: normalizeType(field.type || 'text'),
    }));
    return (parsedSchema?.questions || []).map((question: any, index: number) => ({
      ...question,
      id: String(question.id ?? question.number ?? index + 1),
      label: question.title || question.text || `Question ${question.number || index + 1}`,
      type: normalizeType(question.type || 'text'),
      required: question.required === true,
      points: question.points !== undefined ? Number(question.points) : undefined,
      correctAnswer: question.correctAnswer,
      options: question.options || [],
    }));
  }, [parsedSchema]);

  const optionsFor = (field: FormField) => (field.options || []).map(option => typeof option === 'string' ? option : option.label);
  const change = (id: string, value: any) => setFormData(current => ({ ...current, [id]: value }));

  const handleFileChange = (fieldId: string, file?: File) => {
    if (!file) {
      change(fieldId, '');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setSubmitError('Please select a file smaller than 5 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      change(fieldId, `${file.name} (${Math.round(file.size / 1024)} KB)`);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (parsedSchema?.acceptingResponses === false) {
      setSubmitError('This form is no longer accepting responses.');
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    setSubmitResult(null);
    try {
      const res: any = await onSubmit(formData);
      if (res && typeof res === 'object') {
        setSubmitResult({
          message: res.confirmationMessage || res.message || parsedSchema?.confirmationMessage || 'Your response has been recorded.',
          score: res.score ?? null,
          feedback: res.feedback ?? null,
        });
      } else {
        setSubmitResult({
          message: typeof res === 'string' ? res : (parsedSchema?.confirmationMessage || 'Your response has been recorded.'),
        });
      }
    } catch (error: any) {
      setSubmitError(error?.message || 'Unable to submit this form.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!parsedSchema || fields.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
        This form has no questions yet.
      </div>
    );
  }

  const accent = parsedSchema.themeColor || '#D97757';
  const isClosed = parsedSchema.acceptingResponses === false;

  if (submitResult) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4 text-slate-800">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="h-2.5" style={{ backgroundColor: accent }} />
          <div className="p-6 sm:p-8 space-y-4">
            <h2 className="text-2xl font-bold tracking-tight text-slate-900">
              {parsedSchema.title || 'Untitled form'}
            </h2>
            <p className="text-sm text-slate-700 leading-relaxed">
              {submitResult.message}
            </p>
            {submitResult.score !== null && submitResult.score !== undefined && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                    AI &amp; Quiz Evaluation Score
                  </span>
                  <span className="text-lg font-black text-emerald-700">
                    {submitResult.score} / 100
                  </span>
                </div>
                {submitResult.feedback && (
                  <p className="text-xs text-emerald-900 leading-relaxed">{submitResult.feedback}</p>
                )}
              </div>
            )}
            {parsedSchema.allowMultipleResponses !== false && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setFormData({});
                    setSubmitResult(null);
                    setSubmitError('');
                  }}
                  style={{ color: accent }}
                  className="text-sm font-semibold hover:underline"
                >
                  Submit another response
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto w-full max-w-2xl space-y-4 text-slate-800">
      <header className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="h-2.5" style={{ backgroundColor: accent }} />
        <div className="p-5 sm:p-8">
          <h2 className="break-words text-2xl font-bold tracking-tight sm:text-3xl">{parsedSchema.title || 'Untitled form'}</h2>
          {parsedSchema.description && <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600" dangerouslySetInnerHTML={{ __html: parsedSchema.description }} />}
          {parsedSchema.descriptionImageUrl && <img src={parsedSchema.descriptionImageUrl} alt="Form description attachment" className="mt-4 max-h-[28rem] max-w-full rounded-xl object-contain" />}
          <p className="mt-5 text-xs text-rose-600">* Indicates required question</p>
        </div>
      </header>

      {isClosed && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-sm font-medium text-amber-900">
          This form is no longer accepting responses.
        </div>
      )}

      {parsedSchema.collectEmail && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <label htmlFor="form-_respondentEmail" className="block text-sm font-semibold leading-6 text-slate-800">
            Email address <span className="text-rose-600">*</span>
          </label>
          <input
            id="form-_respondentEmail"
            type="email"
            required
            disabled={isClosed}
            value={formData._respondentEmail ?? ''}
            onChange={e => change('_respondentEmail', e.target.value)}
            placeholder="Your email address"
            className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
          />
        </section>
      )}

      {(parsedSchema.blocks || []).map((block: any) => (
        block.type === 'VIDEO' ? <section key={block.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          {block.title && <h3 className="mb-2 font-semibold">{block.title}</h3>}
          {block.description && <p className="mb-3 whitespace-pre-wrap text-sm text-slate-600">{block.description}</p>}
          {(() => {
            const match = String(block.url || '').match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{11})/);
            return match ? <div className="aspect-video overflow-hidden rounded-xl"><iframe title={block.title || 'Form video'} src={`https://www.youtube-nocookie.com/embed/${match[1]}`} className="h-full w-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen /></div> : <p className="text-xs text-amber-700">Add a valid YouTube video link to display it here.</p>;
          })()}
        </section>
        : block.type === 'IMAGE' ? <section key={block.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          {block.title && <h3 className="mb-2 font-semibold">{block.title}</h3>}{block.description && <p className="mb-3 whitespace-pre-wrap text-sm text-slate-600">{block.description}</p>}
          {block.url && <img src={block.url} alt={block.title || 'Form image'} className="mx-auto max-h-[28rem] max-w-full rounded-xl object-contain" />}
        </section>
        : <section key={block.id} className={`rounded-2xl border bg-white p-5 shadow-sm sm:p-6 ${block.type === 'SECTION' ? 'border-t-4' : 'border-slate-200'}`} style={block.type === 'SECTION' ? { borderTopColor: accent } : undefined}>
          {block.title && <h3 className="text-lg font-bold">{block.title}</h3>}{block.description && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{block.description}</p>}
        </section>
      ))}

      {fields.map((field, index) => {
        const options = optionsFor(field);
        const common = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200';
        return (
          <section key={field.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            {field.sectionTitle && <h3 className="mb-4 border-l-4 pl-3 text-lg font-bold" style={{ borderColor: accent }}>{field.sectionTitle}</h3>}
            {field.contentTitle && <h4 className="mb-2 text-base font-semibold">{field.contentTitle}</h4>}
            {field.imageUrl && <img src={field.imageUrl} alt={field.label || 'Question image'} className="mb-4 max-h-[28rem] max-w-full rounded-xl object-contain" />}
            {field.videoDataUrl && <video controls preload="metadata" src={field.videoDataUrl} className="mb-4 max-h-[28rem] w-full rounded-xl bg-black" />}
            {field.videoUrl && (() => {
              const match = String(field.videoUrl).match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{11})/);
              return match ? <div className="mb-4 aspect-video overflow-hidden rounded-xl"><iframe title={`${field.label} video`} src={`https://www.youtube-nocookie.com/embed/${match[1]}`} className="h-full w-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen /></div> : <p className="mb-4 text-xs text-amber-700">Add a valid YouTube link to show this video.</p>;
            })()}
            <div className="flex items-start justify-between gap-2">
              <label htmlFor={`form-${field.id}`} className="block text-sm font-semibold leading-6 text-slate-800">
                {index + 1}. {field.label} {field.required && <span className="text-rose-600">*</span>}
              </label>
              {field.points !== undefined && field.points > 0 && (
                <span className="shrink-0 text-xs font-medium text-slate-500">
                  {field.points} {field.points === 1 ? 'point' : 'points'}
                </span>
              )}
            </div>
            {field.description && <p className="mt-1 text-xs leading-5 text-slate-500">{field.description}</p>}
            <div className="mt-4">
              {['long_text', 'textarea'].includes(field.type) ? <textarea id={`form-${field.id}`} disabled={isClosed} required={field.required} rows={4} value={formData[field.id] || ''} onChange={e => change(field.id, e.target.value)} placeholder="Your answer" className={`${common} resize-y`} />
              : ['radio', 'checkbox'].includes(field.type) ? <div className="space-y-3">{options.map(option => <label key={option} className="flex min-h-8 items-center gap-3 text-sm cursor-pointer"><input type={field.type} disabled={isClosed} name={`field-${field.id}`} required={field.required && field.type === 'radio'} checked={field.type === 'checkbox' ? (formData[field.id] || []).includes(option) : formData[field.id] === option} onChange={e => field.type === 'checkbox' ? change(field.id, e.target.checked ? [...(formData[field.id] || []), option] : (formData[field.id] || []).filter((value: string) => value !== option)) : change(field.id, option)} style={{ accentColor: accent }} className="h-4 w-4" />{option}</label>)}</div>
              : field.type === 'select' ? <select id={`form-${field.id}`} disabled={isClosed} required={field.required} value={formData[field.id] || ''} onChange={e => change(field.id, e.target.value)} className={common}><option value="">Choose</option>{options.map(option => <option key={option} value={option}>{option}</option>)}</select>
              : field.type === 'linear_scale' ? <div><div className="flex flex-wrap items-start justify-between gap-2 text-xs text-slate-500"><span>{field.scaleMin ?? 1}{field.scaleMinLabel ? ` · ${field.scaleMinLabel}` : ''}</span><span>{field.scaleMax ?? 5}{field.scaleMaxLabel ? ` · ${field.scaleMaxLabel}` : ''}</span></div><div className="mt-3 flex flex-wrap items-center justify-between gap-2">{Array.from({ length: Math.max(2, Math.min(11, (field.scaleMax ?? 5) - (field.scaleMin ?? 1) + 1)) }, (_, i) => (field.scaleMin ?? 1) + i).map(value => <label key={value} className="flex min-w-8 flex-col items-center gap-2 text-xs cursor-pointer"><span>{value}</span><input type="radio" disabled={isClosed} name={`field-${field.id}`} required={field.required} checked={Number(formData[field.id]) === value} onChange={() => change(field.id, value)} style={{ accentColor: accent }} className="h-4 w-4" /></label>)}</div></div>
              : field.type === 'rating' ? <div className="flex flex-wrap gap-2">{Array.from({ length: Math.max(1, Math.min(10, field.maxRating || 5)) }, (_, i) => i + 1).map(value => <button key={value} type="button" disabled={isClosed} aria-label={`${value} out of ${field.maxRating || 5}`} onClick={() => change(field.id, value)} className={`rounded-lg px-2 py-1 text-2xl ${Number(formData[field.id]) >= value ? 'text-amber-500' : 'text-slate-300'}`}>★</button>)}{field.required && !formData[field.id] && <input aria-label={`${field.label} rating`} required type="number" min="1" max={field.maxRating || 5} value="" onChange={e => change(field.id, Number(e.target.value))} className="sr-only" />}</div>
              : ['radio_grid', 'checkbox_grid'].includes(field.type) ? <div className="overflow-x-auto"><table className="w-full min-w-[420px] text-left text-xs"><thead><tr><th className="p-2" />{options.map(option => <th key={option} className="p-2 text-center font-medium text-slate-600">{option}</th>)}</tr></thead><tbody>{(field.rows || []).map((row, rowIndex) => <tr key={row} className="border-t border-slate-100"><th className="p-2 font-medium text-slate-700">{row}</th>{options.map(option => <td key={option} className="p-2 text-center"><input type={field.type === 'radio_grid' ? 'radio' : 'checkbox'} disabled={isClosed} name={`field-${field.id}-${rowIndex}`} aria-label={`${row}: ${option}`} required={field.required && field.type === 'radio_grid'} checked={field.type === 'radio_grid' ? formData[field.id]?.[row] === option : (formData[field.id]?.[row] || []).includes(option)} onChange={e => field.type === 'radio_grid' ? change(field.id, { ...(formData[field.id] || {}), [row]: option }) : change(field.id, { ...(formData[field.id] || {}), [row]: e.target.checked ? [...(formData[field.id]?.[row] || []), option] : (formData[field.id]?.[row] || []).filter((v: string) => v !== option) })} style={{ accentColor: accent }} className="h-4 w-4" /></td>)}</tr>)}</tbody></table></div>
              : field.type === 'file' ? (
                <div className="space-y-2">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">
                    <span>Add file</span>
                    <input
                      id={`form-${field.id}`}
                      type="file"
                      disabled={isClosed}
                      required={field.required && !formData[field.id]}
                      onChange={e => handleFileChange(field.id, e.target.files?.[0])}
                      className="hidden"
                    />
                  </label>
                  {formData[field.id] && (
                    <p className="text-xs font-medium text-emerald-700">Attached: {String(formData[field.id])}</p>
                  )}
                </div>
              )
              : <input id={`form-${field.id}`} disabled={isClosed} type={['email', 'number', 'date', 'time', 'tel', 'url'].includes(field.type) ? field.type : 'text'} required={field.required} value={formData[field.id] ?? ''} onChange={e => change(field.id, e.target.value)} placeholder="Your answer" className={common} />}
            </div>
          </section>
        );
      })}
      {submitError && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{submitError}</p>}
      <div className="flex flex-col-reverse gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <button type="reset" disabled={isClosed} onClick={() => setFormData({})} className="rounded-lg px-4 py-3 text-sm font-semibold text-slate-600 hover:bg-white disabled:opacity-40">Clear form</button>
        <button type="submit" disabled={submitting || isClosed} style={{ backgroundColor: accent }} className="rounded-lg px-7 py-3 text-sm font-bold text-white shadow-sm hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60">{submitting ? 'Submitting…' : 'Submit'}</button>
      </div>
      <p className="pb-5 text-center text-xs text-slate-500">Never submit passwords through forms.</p>
    </form>
  );
}
