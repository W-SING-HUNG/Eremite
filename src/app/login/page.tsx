import { redirect } from "next/navigation";
import { loginAction } from "@/app/actions";
import { isAuthorized, isPasswordConfigured } from "@/platform/auth/service";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await isAuthorized()) redirect("/");
  if (!isPasswordConfigured()) redirect("/setup");
  const { error } = await searchParams;
  return <main className="auth-shell"><section className="auth-card">
    <p className="eyebrow">EREMITE / PRIVATE WORKSPACE</p>
    <h1>输入密码以继续</h1>
    <form action={loginAction} className="stack">
      <label>密码<input type="password" name="password" required autoFocus /></label>
      {error === "incorrect-password" ? <p className="auth-error" role="alert">密码错误，请重新输入。</p> : null}
      <button type="submit">进入工作台</button>
    </form>
  </section></main>;
}
