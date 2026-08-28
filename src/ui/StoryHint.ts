import { fetchAchievements, fetchQuests } from "../net/api";
import {
  EMPTY_STORY_HINT_PROGRESS,
  storyHintText,
  type StoryHintProgress,
} from "../data/storyGates";

/** Подсказка под экраном: порог ачивок или что делать на текущем этапе сюжета. */
export class StoryHint {
  private root = document.getElementById("storyHint")!;
  private token = 0;

  async refresh(progress: StoryHintProgress = EMPTY_STORY_HINT_PROGRESS): Promise<void> {
    const token = ++this.token;
    try {
      const [quests, ach] = await Promise.all([fetchQuests(), fetchAchievements()]);
      if (token !== this.token) return;
      const text = storyHintText(quests.quests, ach.owned, progress);
      if (!text) {
        this.hide();
        return;
      }
      this.root.textContent = text;
      this.root.classList.remove("hidden");
    } catch {
      if (token !== this.token) return;
      this.hide();
    }
  }

  hide(): void {
    this.root.classList.add("hidden");
  }
}
