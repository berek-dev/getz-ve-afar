import { useEffect, useRef, useState } from 'react';
import { api, errorMessage, photoUrl } from '../lib/api.ts';
import type { Photo } from '../core/types.ts';
import { compressImage } from '../lib/image.ts';
import { fmtDateTime } from '../lib/format.ts';
import { useFeatures } from '../lib/features.ts';
import { Icon } from './Icon.tsx';
import { toast } from './Toast.tsx';

/** Site photos for a job: measurements on the wall, before/after, the weld itself. */
export function PhotosSection({ jobId, onCount }: { jobId: number; onCount?: (n: number) => void }) {
  const features = useFeatures();
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Photo | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .photos(jobId)
      .then(setPhotos)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [jobId]);

  useEffect(() => {
    if (photos) onCount?.(photos.length);
  }, [photos, onCount]);

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    const list = [...files];
    setUploading(list.length);
    let ok = 0;
    for (const file of list) {
      try {
        const blob = await compressImage(file);
        const photo = await api.uploadPhoto(jobId, blob);
        setPhotos((p) => [photo, ...(p ?? [])]);
        ok++;
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (ok > 0) toast(ok === 1 ? 'התמונה נשמרה' : `${ok} תמונות נשמרו`);
    if (input.current) input.current.value = '';
  };

  if (!features.photos) {
    return (
      <p className="mt-4 rounded-[10px] border border-steel-700 p-4 text-steel-300">
        שמירת תמונות תופעל אוטומטית בעדכון הבא של השרת. בינתיים אפשר לצלם כרגיל ולשלוח בוואטסאפ.
      </p>
    );
  }

  return (
    <div className="mt-4">
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        id={`photo-input-${jobId}`}
        onChange={(e) => void upload(e.target.files)}
      />
      <label htmlFor={`photo-input-${jobId}`} className="btn-primary cursor-pointer" aria-disabled={uploading > 0}>
        <Icon name="camera" />
        {uploading > 0 ? `מעלה ${uploading}...` : 'צלם או בחר תמונות'}
      </label>
      <p className="mt-2 text-sm text-steel-300">התמונות מוקטנות לפני השליחה, כדי לחסוך בחבילת הגלישה.</p>

      {error && (
        <p className="mt-3 text-primer-light" role="alert">
          {error}
        </p>
      )}

      {photos && photos.length === 0 && uploading === 0 && (
        <p className="mt-6 text-center text-steel-300">עוד אין תמונות. צלם את המקום והמידות לפני שמתחילים.</p>
      )}

      {photos && photos.length > 0 && (
        <ul className="mt-4 grid grid-cols-3 gap-1.5">
          {photos.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setViewing(p)}
                className="block aspect-square w-full overflow-hidden rounded-lg bg-steel-800"
                aria-label={p.caption ?? `תמונה מ־${fmtDateTime(p.created_at)}`}
              >
                <img src={photoUrl(p.id)} alt="" loading="lazy" className="h-full w-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {viewing && (
        <PhotoViewer
          photo={viewing}
          onClose={() => setViewing(null)}
          onChanged={(p) => {
            setPhotos((list) => list?.map((x) => (x.id === p.id ? p : x)) ?? null);
            setViewing(p);
          }}
          onDeleted={(id) => {
            setPhotos((list) => list?.filter((x) => x.id !== id) ?? null);
            setViewing(null);
            toast('התמונה נמחקה');
          }}
        />
      )}
    </div>
  );
}

function PhotoViewer({
  photo,
  onClose,
  onChanged,
  onDeleted,
}: {
  photo: Photo;
  onClose: () => void;
  onChanged: (p: Photo) => void;
  onDeleted: (id: number) => void;
}) {
  const [caption, setCaption] = useState(photo.caption ?? '');
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95" role="dialog" aria-modal="true" aria-label="תמונה">
      <div className="flex items-center justify-between px-3 pt-[max(env(safe-area-inset-top),0.75rem)] pb-2">
        <span className="text-sm text-steel-300">{fmtDateTime(photo.created_at)}</span>
        <button type="button" onClick={onClose} aria-label="סגור" className="grid h-12 w-12 place-items-center rounded-full bg-steel-800">
          <Icon name="close" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <img src={photoUrl(photo.id)} alt={photo.caption ?? ''} className="max-h-full max-w-full object-contain" />
      </div>
      <div className="space-y-2 px-3 pt-2 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
        <input
          className="field"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          onBlur={() => {
            if (caption !== (photo.caption ?? '')) {
              void api.captionPhoto(photo.id, caption).then(onChanged, (e: unknown) => toast(errorMessage(e)));
            }
          }}
          placeholder="הערה לתמונה (למשל: מידה של הפתח)"
          aria-label="הערה לתמונה"
        />
        <button
          type="button"
          onClick={async () => {
            if (!confirm) return setConfirm(true);
            try {
              await api.deletePhoto(photo.id);
              onDeleted(photo.id);
            } catch (e) {
              toast(errorMessage(e));
            }
          }}
          className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border font-semibold ${
            confirm ? 'border-primer bg-primer text-soapstone' : 'border-steel-700 text-primer-light'
          }`}
        >
          <Icon name="trash" size={20} />
          {confirm ? 'לחץ שוב כדי למחוק' : 'מחק תמונה'}
        </button>
      </div>
    </div>
  );
}
