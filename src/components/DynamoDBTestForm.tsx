import React, { useState, useEffect } from 'react';
import { saveMarker, getAllMarkers } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { MapPin, Plus, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';

export default function DynamoDBTestForm() {
  const [name, setName] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [markers, setMarkers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const fetchMarkers = async () => {
    try {
      setLoading(true);
      const items = await getAllMarkers();
      setMarkers(items);
    } catch (err: any) {
      console.error('Failed to fetch markers:', err);
      setStatus({ type: 'error', message: err.message || 'Failed to fetch markers from DynamoDB.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMarkers();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !lat || !lng) {
      setStatus({ type: 'error', message: 'Please fill in all marker fields.' });
      return;
    }

    try {
      setLoading(true);
      setStatus(null);
      const id = uuidv4();
      await saveMarker(id, name, lat, lng);
      setStatus({ type: 'success', message: `Successfully saved marker "${name}" to DynamoDB table ai-markers!` });
      setName('');
      setLat('');
      setLng('');
      await fetchMarkers();
    } catch (err: any) {
      console.error('Failed to save marker:', err);
      setStatus({ type: 'error', message: err.message || 'Failed to save marker to DynamoDB.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6 bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-zinc-200 dark:border-zinc-800 my-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-3 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 rounded-xl">
          <MapPin className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">DynamoDB Marker Test Form</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Test saving and retrieving locations from the live AWS DynamoDB table (`ai-markers`).</p>
        </div>
      </div>

      {status && (
        <div className={`p-4 rounded-xl mb-6 flex items-center gap-3 ${
          status.type === 'success'
            ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
            : 'bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
        }`}>
          {status.type === 'success' ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <AlertCircle className="w-5 h-5 shrink-0" />}
          <span className="text-sm font-medium">{status.message}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 mb-8">
        <div>
          <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider mb-1">
            Marker Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Nairobi Tech Hub"
            className="w-full px-4 py-2.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider mb-1">
              Latitude
            </label>
            <input
              type="number"
              step="any"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              placeholder="-1.2921"
              className="w-full px-4 py-2.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider mb-1">
              Longitude
            </label>
            <input
              type="number"
              step="any"
              value={lng}
              onChange={(e) => setLng(e.target.value)}
              placeholder="36.8219"
              className="w-full px-4 py-2.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl transition-colors flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/25 disabled:opacity-50"
        >
          <Plus className="w-5 h-5" />
          {loading ? 'Saving...' : 'Save Marker to DynamoDB'}
        </button>
      </form>

      <div className="border-t border-zinc-200 dark:border-zinc-800 pt-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Saved Markers ({markers.length})</h3>
          <button
            onClick={fetchMarkers}
            disabled={loading}
            className="p-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            title="Refresh list"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {markers.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center py-8">No markers found in the table yet.</p>
        ) : (
          <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
            {markers.map((marker) => (
              <div key={marker.id} className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-200 dark:border-zinc-700/50 flex justify-between items-center">
                <div>
                  <h4 className="font-semibold text-zinc-900 dark:text-zinc-100 text-sm">{marker.name}</h4>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Lat: {marker.lat}, Lng: {marker.lng}</p>
                </div>
                <span className="text-xs text-zinc-400 dark:text-zinc-500">{new Date(marker.createdAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
