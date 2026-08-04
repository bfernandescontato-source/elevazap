/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    const scriptSrc = process.env.NODE_ENV === "development"
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self' 'unsafe-inline'";
    const contentSecurityPolicy = [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "media-src 'self' blob: https:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.up.railway.app",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ].join("; ");
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: contentSecurityPolicy },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" }
      ]
    }];
  },
  async redirects() {
    return [
      { source: "/mensagem", destination: "/dashboard", permanent: false },
      { source: "/webhooks", destination: "/dashboard", permanent: false },
      { source: "/suporte", destination: "/dashboard", permanent: false },
      { source: "/conexao", destination: "/grupos/numeros", permanent: false }
    ];
  }
};

export default nextConfig;
