import { changePassword } from "../net/api";

// Окно смены пароля: старый пароль, новый и его повтор. Совпадение повтора проверяем
// на клиенте, старый пароль — сервер.
export class PasswordChange {
  isOpen = false;

  private root = document.getElementById("passChange")!;
  private form = document.getElementById("passForm") as HTMLFormElement;
  private oldEl = document.getElementById("passOld") as HTMLInputElement;
  private newEl = document.getElementById("passNew") as HTMLInputElement;
  private repeatEl = document.getElementById("passRepeat") as HTMLInputElement;
  private errorEl = document.getElementById("passError")!;
  private submitEl = document.getElementById("passSubmit") as HTMLButtonElement;

  constructor() {
    document.getElementById("passClose")!.onclick = () => this.close();
    this.form.onsubmit = (e) => {
      e.preventDefault();
      void this.submit();
    };
  }

  open(): void {
    this.isOpen = true;
    this.form.reset();
    this.errorEl.textContent = "";
    this.submitEl.disabled = false;
    this.root.classList.remove("hidden");
    window.addEventListener("keydown", this.onKey, true);
    this.oldEl.focus();
  }

  close(): void {
    this.isOpen = false;
    this.root.classList.add("hidden");
    window.removeEventListener("keydown", this.onKey, true);
  }

  private async submit(): Promise<void> {
    const oldPassword = this.oldEl.value;
    const newPassword = this.newEl.value;
    if (newPassword.length < 6) {
      this.errorEl.textContent = "Новый пароль должен быть не короче 6 символов";
      return;
    }
    if (newPassword !== this.repeatEl.value) {
      this.errorEl.textContent = "Новые пароли не совпадают";
      return;
    }
    this.errorEl.textContent = "";
    this.submitEl.disabled = true;
    try {
      await changePassword(oldPassword, newPassword);
      this.close();
      alert("Пароль изменён");
    } catch (e) {
      this.errorEl.textContent = (e as Error).message;
      this.submitEl.disabled = false;
    }
  }

  private onKey = (e: KeyboardEvent): void => {
    if (!this.isOpen) return;
    // Поля ввода: пропускаем всё, кроме Esc, чтобы игра не перехватывала набор текста.
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      this.close();
    }
  };
}
