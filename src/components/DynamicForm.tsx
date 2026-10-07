import React, { useMemo, useState } from 'react';

type FormField = {
  id: string;
  type: string;
  label: string;
  description?: string;
  required?: boolean;
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

type FormSchema = { title?: string; description?: string; descriptionImageUrl?: string; fields?: FormField[]; questions?: any[]; blocks?: any[]; themeColor?: string };

const normalizeType = (type: string) => ({
  SHORT_TEXT: 'text', LONG_TEXT: 'long_text', MULTIPLE_CHOICE: 'radio', CHECKBOX: 'checkbox',
  DROPDOWN: 'select', DATE: 'date', NUMBER: 'number', EMAIL: 'email', PHONE: 'tel', URL: 'url',
  FILE_UPLOAD: 'file', RATING: 'rating', LINEAR_SCALE: 'linear_scale', MULTIPLE_CHOICE_GRID: 'radio_grid',
  CHECKBOX_GRID: 'checkbox_grid', TIME: 'time',
} as Record<string, string>)[type] || (type === 'mcq' ? 'select' : type === 'essay' ? 'long_text' : type);

export default function DynamicForm({ schema, onSubmit }: { schema: string | any; onSubmit: (data: any) => void | Promise<void> }) {
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const parsedSchema = useMemo<FormSchema | null>(() => {
    if (!schema) return null;
    if (typeof schema !== 'string') return schema;
    try { return JSON.parse(schema); }
    catch (error) { console.error('DynamicForm: Failed to parse schema string', error); return null; }
  }, [schema]);

  const fields: FormField[] = useMemo(() => {
    if (Array.isArray(parsedSchema?.fields)) return parsedSchema.fields.map((field: any, index) => ({
      ...field, id: String(field.id ?? index + 1), label: field.label || field.title || `Question ${index + 1}`, type: normalizeType(field.type || 'text'),
    }));
    return (parsedSchema?.questions || []).map((question: any, index: number) => ({
      ...question,
      id: String(question.id ?? question.number ?? index + 1),
      label: question.title || question.text || `Question ${question.number || index + 1}`,
      type: normalizeType(question.type || 'text'),
      required: question.required === true,
      options: question.options || [],
    }));
  }, [parsedSchema]);

  const optionsFor = (field: FormField) => (field.options || []).map(option => typeof option === 'string' ? option : option.label);
  const change = (id: string, value: any) => setFormData(current => ({ ...current, [id]: value }));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault(); setSubmitting(true); setSubmitError('');
    try { await onSubmit(formData); }
    catch (error: any) { setSubmitError(error?.message || 'Unable to submit this form.'); }
    finally { setSubmitting(false); }
  };

  if (!parsedSchema || fields.length === 0) return <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">This form has no questions yet.</div>;

  const accent = parsedSchema.themeColor || '#D97757';
  return (
    <form onSubmit={handleSubmit} className="mx-auto w-full max-w-2xl space-y-4 text-slate-800">
      <header className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="h-2" style={{ backgroundColor: accent }} />
        <div className="p-5 sm:p-8">
          <h2 className="break-words text-2xl font-bold tracking-tight sm:text-3xl">{parsedSchema.title || 'Untitled form'}</h2>
          {parsedSchema.description && <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600" dangerouslySetInnerHTML={{ __html: parsedSchema.description }} />}
          {parsedSchema.descriptionImageUrl && <img src={parsedSchema.descriptionImageUrl} alt="Form description attachment" className="mt-4 max-h-[28rem] max-w-full rounded-xl object-contain" />}
          <p className="mt-5 text-xs text-rose-600">* Indicates required question</p>
        </div>
      </header>

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
            <label htmlFor={`form-${field.id}`} className="block text-sm font-semibold leading-6 text-slate-800">
              {index + 1}. {field.label} {field.required && <span className="text-rose-600">*</span>}
            </label>
            {field.description && <p className="mt-1 text-xs leading-5 text-slate-500">{field.description}</p>}
            <div className="mt-4">
              {['long_text', 'textarea'].includes(field.type) ? <textarea id={`form-${field.id}`} required={field.required} rows={4} value={formData[field.id] || ''} onChange={e => change(field.id, e.target.value)} placeholder="Your answer" className={`${common} resize-y`} />
              : ['radio', 'checkbox'].includes(field.type) ? <div className="space-y-3">{options.map(option => <label key={option} className="flex min-h-8 items-center gap-3 text-sm"><input type={field.type} name={`field-${field.id}`} required={field.required && field.type === 'radio'} checked={field.type === 'checkbox' ? (formData[field.id] || []).includes(option) : formData[field.id] === option} onChange={e => field.type === 'checkbox' ? change(field.id, e.target.checked ? [...(formData[field.id] || []), option] : (formData[field.id] || []).filter((value: string) => value !== option)) : change(field.id, option)} className="h-4 w-4 accent-[#673ab7]" />{option}</label>)}</div>
              : field.type === 'select' ? <select id={`form-${field.id}`} required={field.required} value={formData[field.id] || ''} onChange={e => change(field.id, e.target.value)} className={common}><option value="">Choose</option>{options.map(option => <option key={option} value={option}>{option}</option>)}</select>
              : field.type === 'linear_scale' ? <div><div className="flex flex-wrap items-start justify-between gap-2 text-xs text-slate-500"><span>{field.scaleMin ?? 1}{field.scaleMinLabel ? ` · ${field.scaleMinLabel}` : ''}</span><span>{field.scaleMax ?? 5}{field.scaleMaxLabel ? ` · ${field.scaleMaxLabel}` : ''}</span></div><div className="mt-3 flex flex-wrap items-center justify-between gap-2">{Array.from({ length: Math.max(2, Math.min(11, (field.scaleMax ?? 5) - (field.scaleMin ?? 1) + 1)) }, (_, i) => (field.scaleMin ?? 1) + i).map(value => <label key={value} className="flex min-w-8 flex-col items-center gap-2 text-xs"><span>{value}</span><input type="radio" name={`field-${field.id}`} required={field.required} checked={Number(formData[field.id]) === value} onChange={() => change(field.id, value)} className="h-4 w-4 accent-[#673ab7]" /></label>)}</div></div>
              : field.type === 'rating' ? <div className="flex flex-wrap gap-2">{Array.from({ length: Math.max(1, Math.min(10, field.maxRating || 5)) }, (_, i) => i + 1).map(value => <button key={value} type="button" aria-label={`${value} out of ${field.maxRating || 5}`} onClick={() => change(field.id, value)} className={`rounded-lg px-2 py-1 text-2xl ${Number(formData[field.id]) >= value ? 'text-amber-500' : 'text-slate-300'}`}>★</button>)}{field.required && !formData[field.id] && <input aria-label={`${field.label} rating`} required type="number" min="1" max={field.maxRating || 5} value="" onChange={e => change(field.id, Number(e.target.value))} className="sr-only" />}</div>
              : ['radio_grid', 'checkbox_grid'].includes(field.type) ? <div className="overflow-x-auto"><table className="w-full min-w-[420px] text-left text-xs"><thead><tr><th className="p-2" />{options.map(option => <th key={option} className="p-2 text-center font-medium text-slate-600">{option}</th>)}</tr></thead><tbody>{(field.rows || []).map((row, rowIndex) => <tr key={row} className="border-t border-slate-100"><th className="p-2 font-medium text-slate-700">{row}</th>{options.map(option => <td key={option} className="p-2 text-center"><input type={field.type === 'radio_grid' ? 'radio' : 'checkbox'} name={`field-${field.id}-${rowIndex}`} aria-label={`${row}: ${option}`} required={field.required && field.type === 'radio_grid'} checked={field.type === 'radio_grid' ? formData[field.id]?.[row] === option : (formData[field.id]?.[row] || []).includes(option)} onChange={e => field.type === 'radio_grid' ? change(field.id, { ...(formData[field.id] || {}), [row]: option }) : change(field.id, { ...(formData[field.id] || {}), [row]: e.target.checked ? [...(formData[field.id]?.[row] || []), option] : (formData[field.id]?.[row] || []).filter((v: string) => v !== option) })} className="h-4 w-4 accent-[#673ab7]" /></td>)}</tr>)}</tbody></table></div>
              : field.type === 'file' ? <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50 p-3 text-xs leading-5 text-amber-800">File upload questions are not available yet. Please contact the form owner for another way to share your file.</div>
              : <input id={`form-${field.id}`} type={['email', 'number', 'date', 'time', 'tel', 'url'].includes(field.type) ? field.type : 'text'} required={field.required} value={formData[field.id] ?? ''} onChange={e => change(field.id, e.target.value)} placeholder="Your answer" className={common} />}
            </div>
          </section>
        );
      })}
      {submitError && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{submitError}</p>}
      <div className="flex flex-col-reverse gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <button type="reset" onClick={() => setFormData({})} className="rounded-lg px-4 py-3 text-sm font-semibold text-slate-600 hover:bg-white">Clear form</button>
        <button type="submit" disabled={submitting} style={{ backgroundColor: accent }} className="rounded-lg px-7 py-3 text-sm font-bold text-white shadow-sm hover:brightness-95 disabled:cursor-wait disabled:opacity-60">{submitting ? 'Submitting…' : 'Submit'}</button>
      </div>
      <p className="pb-5 text-center text-xs text-slate-500">Never submit passwords through forms.</p>
    </form>
  );
}
