import { dismissNotice } from "@app/store";
import { useStore } from "@ui/hooks/use-store";
import { useServices } from "@ui/services/use-services";

const MAX_DETAILS = 5;

export function NoticeBar() {
  const { notices } = useServices().deps;
  const notice = useStore(notices, (state) => state.notice);
  if (notice === null) return null;

  const details = notice.details ?? [];
  const hidden = details.length - MAX_DETAILS;

  return (
    <div
      className={`notice notice--${notice.tone}`}
      role={notice.tone === "error" ? "alert" : "status"}
    >
      <div className="notice__body">
        <p className="notice__title">{notice.title}</p>
        {details.length > 0 && (
          <ul className="notice__details">
            {details.slice(0, MAX_DETAILS).map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
            {hidden > 0 && <li>{hidden} more</li>}
          </ul>
        )}
      </div>
      <button
        type="button"
        className="notice__close"
        aria-label="Dismiss"
        onClick={() => {
          dismissNotice(notices);
        }}
      >
        ×
      </button>
    </div>
  );
}
