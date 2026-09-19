import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { publicUrl } from "@/lib/public-url";

const INTERNAL = "https://0.0.0.0:3000/api/auth/login";
const request = (headers: Record<string, string>, url = INTERNAL) => new NextRequest(url, { method: "POST", headers });

describe("publicUrl", () => {
  const original = process.env.NEXT_PUBLIC_APP_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = original;
  });

  it("usa o endereço público informado pelo proxy, não o interno do container", () => {
    const url = publicUrl("/dashboard", request({ "x-forwarded-host": "staging.disparei.pro", "x-forwarded-proto": "https" }));
    expect(url.toString()).toBe("https://staging.disparei.pro/dashboard");
  });

  it("preserva query string e aceita www e o domínio raiz", () => {
    expect(publicUrl("/login?error=invalid", request({ "x-forwarded-host": "www.disparei.pro", "x-forwarded-proto": "https" })).toString())
      .toBe("https://www.disparei.pro/login?error=invalid");
    expect(publicUrl("/login", request({ "x-forwarded-host": "disparei.pro", "x-forwarded-proto": "https" })).toString())
      .toBe("https://disparei.pro/login");
  });

  it("usa o primeiro valor quando o proxy encadeia cabeçalhos", () => {
    const url = publicUrl("/login", request({ "x-forwarded-host": "www.disparei.pro, 10.0.0.2", "x-forwarded-proto": "https, http" }));
    expect(url.toString()).toBe("https://www.disparei.pro/login");
  });

  it("ignora host forjado que não é conhecido e cai no comportamento antigo", () => {
    const url = publicUrl("/dashboard", request({ "x-forwarded-host": "evil.example.com", "x-forwarded-proto": "https" }));
    expect(url.toString()).toBe("https://0.0.0.0:3000/dashboard");
  });

  it("aceita o host configurado em NEXT_PUBLIC_APP_URL (ex.: deploy na Vercel)", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://elevazap-web.vercel.app";
    const url = publicUrl("/login", request({ host: "elevazap-web.vercel.app", "x-forwarded-proto": "https" }));
    expect(url.toString()).toBe("https://elevazap-web.vercel.app/login");
  });

  it("mantém http em desenvolvimento local", () => {
    const url = publicUrl("/dashboard", request({ host: "localhost:3000" }, "http://localhost:3000/api/auth/login"));
    expect(url.toString()).toBe("http://localhost:3000/dashboard");
  });

  it("sem cabeçalhos de proxy usa request.url", () => {
    expect(publicUrl("/login", request({})).toString()).toBe("https://0.0.0.0:3000/login");
  });
});
