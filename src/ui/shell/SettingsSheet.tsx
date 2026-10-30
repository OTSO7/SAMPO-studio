import { save } from "@app/commands";
import { editStory } from "@app/store";
import { setStorySettings } from "@core/model";
import { SfxVolume } from "@ui/board/SfxVolume";
import { useStore } from "@ui/hooks/use-store";
import { Sheet } from "@ui/primitives/Sheet";
import { useServices } from "@ui/services/use-services";

/** The story's settings. They are saved in its file, so they go wherever the story goes. */
export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const { deps } = useServices();
  const { document } = deps;
  const safeAudio = useStore(document, (s) => s.story?.settings?.safeAudio === true);

  return (
    <Sheet title="Settings" className="settings" onClose={onClose}>
      <div className="sheet__body settings__body">
        <section className="settings__group">
          <h3 className="settings__heading">Playback</h3>
          <div className="settings__row">
            <div className="settings__text">
              <span className="settings__name" id="safe-audio-name">
                Safe audio mode
              </span>
              <p className="settings__help" id="safe-audio-help">
                Asks for confirmation before a playing song is stopped, restarted or replaced.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              className="settings__switch"
              aria-checked={safeAudio}
              aria-labelledby="safe-audio-name"
              aria-describedby="safe-audio-help"
              onClick={() => {
                editStory(document, (s) => setStorySettings(s, { safeAudio: !safeAudio }));
              }}
            />
          </div>
          <div className="settings__row">
            <div className="settings__text">
              <span className="settings__name">Sound effect volume</span>
              <p className="settings__help">
                Sets the level of all sound effects. Each effect also has its own volume. Music is
                not affected.
              </p>
            </div>
            <SfxVolume />
          </div>
        </section>
      </div>
      <footer className="settings__foot">
        <span className="settings__note">Settings are stored in the story file.</span>
        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            void save(deps).then((saved) => {
              if (saved) onClose();
            });
          }}
        >
          Save
        </button>
      </footer>
    </Sheet>
  );
}
