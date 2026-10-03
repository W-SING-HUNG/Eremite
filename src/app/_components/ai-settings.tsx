"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/app/_components/ui/button";
import { ControlField, Field, TextInput } from "@/app/_components/ui/field";
import { Notice } from "@/app/_components/ui/surface";
import { probeDiagnostics, type Probe } from "@/app/_components/ai-probe-diagnostics";

type Settings = { source: "app" | "environment" | "unconfigured"; provider: "openai-compatible"; baseURL: string; model: string; hasApiKey: boolean; needsApiKey: boolean; configured: boolean };

const sourceName = { app: "应用设置", environment: "环境变量", unconfigured: "未配置" };

export function AISettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [baseURL, setBaseURL] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [probe, setProbe] = useState<Probe | null>(null);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error" | "info">("info");
  const [busy, setBusy] = useState<"test" | "save" | "revert" | null>(null);
  const refresh = useCallback(async () => {
    const response = await fetch("/api/settings/ai", { cache: "no-store" });
    if (!response.ok) throw new Error("settings_load_failed");
    const value = await response.json() as Settings;
    setSettings(value);
    setBaseURL(value.baseURL);
    setModel(value.model);
    setApiKey("");
  }, []);
  useEffect(() => { void refresh().catch(() => { setMessageKind("error"); setMessage("无法读取 AI 设置。"); }); }, [refresh]);

  const perform = async (action: "test" | "save" | "revert") => {
    setBusy(action);
    setMessage("");
    const previousProbe = probe;
    if (action !== "test") setProbe(null);
    try {
      const response = await fetch("/api/settings/ai", {
        method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "revert" ? { action } : { action, baseURL, model, apiKey }),
      });
      if (!response.ok) {
        const value = await response.json() as { code?: string };
        if (value.code === "ai_api_key_missing") throw new Error("请明确输入新的 API Key。已有环境变量密钥不会复制到应用设置。");
        if (value.code === "ai_base_url_invalid") throw new Error("Base URL 无效。请使用 HTTPS，或仅对本机地址使用 HTTP。");
        if (value.code === "ai_model_missing") throw new Error("请输入有效的 Model ID。");
        throw new Error("操作失败。原有有效配置不会与新配置混用。");
      }
      if (action === "test") {
        const value = await response.json() as Probe;
        setProbe(value);
        setMessageKind(value.success ? "success" : "error");
        setMessage(value.success ? "连接测试成功。此结果未保存。" : "连接测试未通过。此结果未保存。");
      } else {
        await refresh();
        setMessageKind(action === "revert" || previousProbe?.success ? "success" : "info");
        setMessage(action === "save"
          ? previousProbe?.success ? "已保存，连接测试已通过。新的 AI 请求将使用此配置。" : previousProbe ? "已保存，但连接测试未通过。新的 AI 请求将使用此配置。" : "已保存，尚未测试连接。新的 AI 请求将使用此配置。"
          : "已恢复使用环境变量配置。");
      }
    } catch (error) { setMessageKind("error"); setMessage(error instanceof Error ? error.message : "操作失败。"); }
    finally { setBusy(null); }
  };

  return <section className="ai-settings-page" aria-labelledby="settings-heading">
    <header className="workspace-toolbar"><div><h1 id="settings-heading">设置</h1><p>AI Provider</p></div></header>
    <div className="ai-settings-card">
      <h2>AI Provider</h2>
      <p>配置 Eremite Host 使用的 OpenAI-compatible Provider。</p>
      <div className="ai-settings-status" aria-live="polite">
        <span>当前来源：<strong>{settings ? sourceName[settings.source] : "读取中"}</strong></span>
        <span>当前有效模型：<strong>{settings?.configured ? settings.model : "无"}</strong></span>
        <span>API Key：<strong>{settings?.hasApiKey ? "已配置" : settings?.needsApiKey ? "需要重新输入 API Key" : "未配置"}</strong></span>
      </div>
      <div className="ai-settings-fields">
        <ControlField label="Provider"><span className="ai-settings-provider-value">OpenAI-compatible</span></ControlField>
        <Field label="Base URL">{({ controlId }) => <TextInput id={controlId} type="url" autoComplete="off" value={baseURL} onChange={event => { setBaseURL(event.target.value); setProbe(null); setMessage(""); }} placeholder="https://api.example.com/v1" maxLength={2048} />}</Field>
        <Field label="API Key" description="已保存的 Key 不会回显。输入新 Key 可更换；首次从环境变量切换时必须输入。">{({ controlId, descriptionId }) => <TextInput id={controlId} aria-describedby={descriptionId} type="password" autoComplete="new-password" value={apiKey} onChange={event => { setApiKey(event.target.value); setProbe(null); setMessage(""); }} placeholder={settings?.source === "app" && settings.hasApiKey ? "留空以保留已保存的 Key" : "输入新的 API Key"} maxLength={2560} />}</Field>
        <Field label="Model ID">{({ controlId }) => <TextInput id={controlId} value={model} onChange={event => { setModel(event.target.value); setProbe(null); setMessage(""); }} placeholder="model-id" maxLength={256} />}</Field>
      </div>
      <div className="ai-settings-actions">
        <Button type="button" loading={busy === "test"} disabled={busy !== null} onClick={() => void perform("test")}>测试连接</Button>
        <Button type="button" variant="primary" loading={busy === "save"} disabled={busy !== null} onClick={() => void perform("save")}>保存</Button>
        <Button type="button" variant="ghost" loading={busy === "revert"} disabled={busy !== null || settings?.source !== "app"} onClick={() => void perform("revert")}>恢复使用环境变量</Button>
      </div>
      {message && <Notice kind={messageKind}>{message}</Notice>}
      {probe && <div className="ai-settings-probe" role="status"><strong>连接{probe.success ? "成功" : "失败"}</strong><span>Text: {probe.text ? "PASS" : "FAIL"}</span><span>Structured Output: {probe.structuredOutput ? "PASS" : "FAIL"}</span><span>Tool Calling: {probe.toolCalling ? "PASS" : "FAIL"}</span>{probeDiagnostics(probe).map(diagnostic => <span key={diagnostic}>{diagnostic}</span>)}</div>}
    </div>
  </section>;
}
