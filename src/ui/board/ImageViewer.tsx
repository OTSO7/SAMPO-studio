import { useEffect, useRef } from "react";

interface ImageViewerProps {
  src: string;
  caption: string;
  onClose: () => void;
}

/** A picture at full size over everything else. Esc or a click anywhere closes it. */
export function ImageViewer({ src, caption, onClose }: ImageViewerProps) {
  const ref = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className="image-viewer"
      aria-label={caption === "" ? "Image" : caption}
      onClose={onClose}
      onClick={onClose}
      onKeyDown={(event) => {
        // Keep Esc from also closing the inspector or leaving focus mode behind the viewer.
        if (event.key === "Escape") event.stopPropagation();
      }}
    >
      <img src={src} alt={caption} />
      {caption !== "" && <p className="image-viewer__caption">{caption}</p>}
    </dialog>
  );
}
