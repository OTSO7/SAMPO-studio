import { sfxVolume } from "@app/sfx";
import { editStory } from "@app/store";
import { setStorySettings } from "@core/model";
import { useStore } from "@ui/hooks/use-store";
import { useServices } from "@ui/services/use-services";

/** How loud the sound effects play, for all of them at once. Music stays at its own level. */
export function SfxVolume() {
  const { document } = useServices().deps;
  const level = useStore(sfxVolume, (s) => s.level);
  const percent = Math.round(level * 100);
  return (
    <label className="sfx-volume" title="Volume of the sound effects. Music is not affected.">
      <span className="sfx-volume__name">SFX</span>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={percent}
        aria-label="Sound effect volume"
        aria-valuetext={`${percent} percent`}
        onChange={(event) => {
          const sfxVolume = Number(event.target.value) / 100;
          // One undo step for one drag of the slider.
          editStory(document, (s) => setStorySettings(s, { sfxVolume }), { group: "sfx-volume" });
        }}
      />
      <span className="sfx-volume__value">{percent}%</span>
    </label>
  );
}
