import { publicPath } from "../publicPath";

const MUSIC_VOLUME = 0.18;
const ENABLED_KEY = "bulba_music_enabled";
const TRACK_KEY = "bulba_music_track";

interface MusicTrack {
  id: string;
  label: string;
  file: string;
}

const TRACKS: MusicTrack[] = [
  { id: "chill", label: "Чиловая", file: "background.mp3" },
  { id: "romantic", label: "Романтическая", file: "romantic.mp3" },
  { id: "vibecoding", label: "Для вайбкодинга", file: "vibecoding.mp3" },
  { id: "meditation", label: "Медитация", file: "meditation.mp3" },
  { id: "angel", label: "Ангельская", file: "angel.mp3" },
  { id: "african", label: "Африканская", file: "african.mp3" },
  { id: "hiphop", label: "Хип-хоп", file: "hiphop.mp3" },
];

export class BackgroundMusic {
  private audio = new Audio();
  private enabled = localStorage.getItem(ENABLED_KEY) === "1";
  private unlocked = false;
  private trackId = this.validTrackId(localStorage.getItem(TRACK_KEY) ?? "chill");
  private toggleBtn: HTMLButtonElement | null = null;
  private dropdownEl: HTMLElement | null = null;
  private dropdownBtn: HTMLButtonElement | null = null;
  private dropdownLabel: HTMLElement | null = null;
  private dropdownMenu: HTMLElement | null = null;

  constructor() {
    this.audio.loop = true;
    this.audio.preload = "auto";
    this.audio.volume = MUSIC_VOLUME;
    this.applyTrack();
  }

  install(): void {
    this.bindControls();

    const unlock = (): void => {
      this.unlocked = true;
      if (this.enabled) this.play();
    };

    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    window.addEventListener("touchstart", unlock, { once: true });
  }

  private bindControls(): void {
    this.toggleBtn = document.getElementById("musicToggle") as HTMLButtonElement | null;
    this.dropdownEl = document.getElementById("musicDropdown");
    this.dropdownBtn = document.getElementById("musicDropdownBtn") as HTMLButtonElement | null;
    this.dropdownLabel = document.getElementById("musicDropdownLabel");
    this.dropdownMenu = document.getElementById("musicDropdownMenu");
    if (!this.toggleBtn || !this.dropdownEl || !this.dropdownBtn || !this.dropdownLabel || !this.dropdownMenu) return;

    this.dropdownMenu.innerHTML = "";
    for (const track of TRACKS) {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "hud-dropdown-option";
      option.dataset.trackId = track.id;
      option.textContent = track.label;
      option.setAttribute("role", "option");
      option.onclick = () => {
        this.setTrack(track.id);
        this.setDropdownOpen(false);
      };
      this.dropdownMenu.appendChild(option);
    }
    this.dropdownBtn.onclick = (e) => {
      e.stopPropagation();
      this.setDropdownOpen(!this.dropdownEl!.classList.contains("open"));
    };
    this.toggleBtn.onclick = () => this.setEnabled(!this.enabled);
    document.addEventListener("pointerdown", (e) => {
      if (!this.dropdownEl?.contains(e.target as Node)) this.setDropdownOpen(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.code === "Escape") this.setDropdownOpen(false);
    });
    this.renderControls();
  }

  private setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    localStorage.setItem(ENABLED_KEY, enabled ? "1" : "0");
    if (enabled) this.play();
    else this.pause();
    this.renderControls();
  }

  private setTrack(trackId: string): void {
    this.trackId = this.validTrackId(trackId);
    localStorage.setItem(TRACK_KEY, this.trackId);
    const wasPlaying = this.enabled && !this.audio.paused;
    this.applyTrack();
    if (this.enabled && (this.unlocked || wasPlaying)) this.play();
    this.renderControls();
  }

  private applyTrack(): void {
    const track = this.currentTrack();
    this.audio.src = publicPath(`assets/audio/${track.file}`);
    this.audio.load();
  }

  private play(): void {
    if (!this.unlocked) return;
    void this.audio.play().catch(() => {});
  }

  private pause(): void {
    this.audio.pause();
  }

  private renderControls(): void {
    if (this.toggleBtn) this.toggleBtn.textContent = this.enabled ? "🔊 Музыка включена" : "🔇 Музыка выключена";
    if (this.dropdownLabel) this.dropdownLabel.textContent = this.currentTrack().label;
    this.dropdownMenu?.querySelectorAll<HTMLElement>(".hud-dropdown-option").forEach((option) => {
      const selected = option.dataset.trackId === this.trackId;
      option.classList.toggle("sel", selected);
      option.setAttribute("aria-selected", selected ? "true" : "false");
    });
  }

  private setDropdownOpen(open: boolean): void {
    this.dropdownEl?.classList.toggle("open", open);
    this.dropdownBtn?.setAttribute("aria-expanded", open ? "true" : "false");
  }

  private currentTrack(): MusicTrack {
    return TRACKS.find((track) => track.id === this.trackId) ?? TRACKS[0];
  }

  private validTrackId(trackId: string): string {
    return TRACKS.some((track) => track.id === trackId) ? trackId : TRACKS[0].id;
  }
}
