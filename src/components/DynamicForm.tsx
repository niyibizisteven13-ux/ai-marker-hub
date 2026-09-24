import React, { useState, useMemo } from 'react';

interface Field {
  id: string;
  type: 'text' | 'long_text' | 'email' | 'number' | 'file' | 'select';
  label: string;
  required: boolean;
  options?: string[];
}

interface Schema {
  title: string;
  description?: string;
  fields?: Field[];
  questions?: any[]; // Handle ExamPaper questions as well
}

export default function DynamicForm({ schema, onSubmit }: { schema: string | any, onSubmit: (data: any) => void }) {
  const [formData, setFormData] = useState<Record<string, any>>({});

  const parsedSchema = useMemo(() => {
    if (!schema) return null;
    if (typeof schema !== 'string') return schema;
    try {
      return JSON.parse(schema);
    } catch (e) {
      console.error('DynamicForm: Failed to parse schema string', e);
      return null;
    }
  }, [schema]);

  const handleChange = (id: string, value: any) => {
    setFormData(prev => ({ ...prev, [id]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  const fields = parsedSchema?.fields || parsedSchema?.questions?.map((q: any) => ({
    id: q.id || q.number,
    label: `Question ${q.number}: ${q.text}`,
    type: q.type === 'mcq' ? 'select' : (q.type === 'essay' ? 'long_text' : 'text'),
    required: true,
    options: q.options
  })) || [];

  if (!parsedSchema || fields.length === 0) {
    return (
      <div className="p-8 text-center text-slate-500 border border-dashed border-slate-800 rounded-3xl">
        <p>Form schema is incomplete or invalid.</p>
        <p className="text-[10px] mt-2 text-slate-600">Ensure the schema contains "fields" or "questions".</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl mx-auto p-8 rounded-3xl border border-slate-800 bg-[#0D111A]">
      <div className="space-y-1">
        <h2 className="text-xl font-bold text-slate-100">{parsedSchema.title || 'Untitled Form'}</h2>
        {parsedSchema.description && <p className="text-sm text-slate-500">{parsedSchema.description}</p>}
      </div>

      <div className="space-y-4">
        {fields.map((field: any) => (
          <label key={field.id} className="block space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              {field.label} {field.required && <span className="text-rose-500">*</span>}
            </span>

            {field.type === 'long_text' ? (
              <textarea
                required={field.required}
                onChange={(e) => handleChange(field.id, e.target.value)}
                className="w-full rounded-2xl border border-slate-800 bg-[#090C15] px-4 py-3 text-sm outline-none focus:border-orange-500"
                rows={4}
              />
            ) : field.type === 'select' ? (
              <select
                required={field.required}
                onChange={(e) => handleChange(field.id, e.target.value)}
                className="w-full rounded-2xl border border-slate-800 bg-[#090C15] px-4 py-3 text-sm outline-none focus:border-orange-500 appearance-none"
              >
                <option value="">Select option</option>
                {field.options?.map(opt => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            ) : (
              <input
                type={field.type}
                required={field.required}
                onChange={(e) => handleChange(field.id, field.type === 'file' ? e.target.files?.[0] : e.target.value)}
                className="w-full rounded-2xl border border-slate-800 bg-[#090C15] px-4 py-3 text-sm outline-none focus:border-orange-500"
              />
            )}
          </label>
        ))}
      </div>

      <button
        type="submit"
        className="w-full rounded-2xl bg-orange-500 py-3 text-sm font-bold uppercase tracking-wider text-white hover:bg-orange-600 transition-colors"
      >
        Submit Application
      </button>
    </form>
  );
}
