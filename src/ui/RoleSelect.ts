import { ROLES, type RoleDef } from "../data/roles";
import { drawContain, getSpriteImage } from "../entities/sprites";

// Экран выбора роли для мультиплеера. От роли зависит скин.
export function showRoleSelect(onPick: (role: RoleDef) => void): void {
  const root = document.getElementById("roleSelect")!;
  const cards = document.getElementById("roleCards")!;
  cards.innerHTML = "";

  for (const role of ROLES) {
    const card = document.createElement("div");
    card.className = "card";

    const cv = document.createElement("canvas");
    cv.width = 84;
    cv.height = 84;
    drawContain(cv.getContext("2d")!, getSpriteImage(role.sprite), 84);
    card.appendChild(cv);

    card.insertAdjacentHTML("beforeend", `<div class="nm">${role.label}</div><div class="rl">${role.id}</div>`);
    card.onclick = () => {
      root.classList.add("hidden");
      onPick(role);
    };
    cards.appendChild(card);
  }

  root.classList.remove("hidden");
}
