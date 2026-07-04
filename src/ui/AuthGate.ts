import { login, register } from "../net/api";

type Mode = "login" | "register";

// Окно входа/регистрации при запуске. open() показывает окно и резолвится, когда
// пользователь успешно авторизовался (токен уже сохранён в localStorage api-клиентом).
export class AuthGate {
  private root = document.getElementById("auth")!;
  private title = document.getElementById("authTitle")!;
  private tabLogin = document.getElementById("authTabLogin")!;
  private tabRegister = document.getElementById("authTabRegister")!;
  private form = document.getElementById("authForm") as HTMLFormElement;
  private loginEl = document.getElementById("authLogin") as HTMLInputElement;
  private passwordEl = document.getElementById("authPassword") as HTMLInputElement;
  private errorEl = document.getElementById("authError")!;
  private submitEl = document.getElementById("authSubmit") as HTMLButtonElement;

  private mode: Mode = "login";
  private done: (() => void) | null = null;

  constructor() {
    this.tabLogin.onclick = () => this.setMode("login");
    this.tabRegister.onclick = () => this.setMode("register");
    this.form.onsubmit = (e) => {
      e.preventDefault();
      void this.submit();
    };
    // Клавиши полей не должны доходить до управления миром (Phaser).
    for (const el of [this.loginEl, this.passwordEl]) {
      el.addEventListener("keydown", (e) => e.stopPropagation());
    }
  }

  open(): Promise<void> {
    this.root.classList.remove("hidden");
    this.setMode("login");
    this.loginEl.value = "";
    this.passwordEl.value = "";
    this.loginEl.focus();
    return new Promise((resolve) => {
      this.done = resolve;
    });
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    this.errorEl.textContent = "";
    this.tabLogin.classList.toggle("sel", mode === "login");
    this.tabRegister.classList.toggle("sel", mode === "register");
    this.title.textContent = mode === "login" ? "Вход" : "Регистрация";
    this.submitEl.textContent = mode === "login" ? "Войти" : "Зарегистрироваться";
  }

  private async submit(): Promise<void> {
    const loginValue = this.loginEl.value.trim();
    const passwordValue = this.passwordEl.value;
    if (!loginValue || !passwordValue) {
      this.errorEl.textContent = "Введите логин и пароль";
      return;
    }

    this.submitEl.disabled = true;
    this.errorEl.textContent = "";
    try {
      if (this.mode === "register") await register(loginValue, passwordValue);
      else await login(loginValue, passwordValue);
      this.root.classList.add("hidden");
      this.done?.();
      this.done = null;
    } catch (e) {
      this.errorEl.textContent = (e as Error).message;
    } finally {
      this.submitEl.disabled = false;
    }
  }
}
