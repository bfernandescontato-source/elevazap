/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
