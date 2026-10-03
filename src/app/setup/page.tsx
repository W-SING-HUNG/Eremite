import { redirect } from "next/navigation";
import { setupAction } from "@/app/actions";
import { isAuthorized, isPasswordConfigured } from "@/platform/auth/service";

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await isAuthorized()) redirect("/");
  if (isPasswordConfigured()) redirect("/login");
  const { error } = await searchParams;
  return <main className="auth-shell"><section className="auth-card">
    <p className="eyebrow">EREMITE / INITIAL SETUP</p>
    <h1>为你的数字底座设置门锁</h1>
    <p>密码只用于这台应用的单用户访问。请使用至少 12 个字符的强密码。</p>
    <form action={setupAction} className="stack">
      <label>初始密码<input type="password" name="password" minLength={12} required autoFocus /></label>
      {error === "password-too-short" ? <p className="auth-error" role="alert">密码至少需要 12 个字符。</p> : null}
      <button type="submit">创建并进入</button>
    </form>
  </section></main>;
}
