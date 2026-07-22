/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '20mb',
    },
    // PDF.jsを含むpdf-parseはサーバー側でNode.js依存として実行する。
    // バンドル対象にすると開発時にPDF.jsのESM読込が失敗するため、Vercel関数へ外部依存として同梱する。
    serverComponentsExternalPackages: ['pdf-parse'],
    // 依存トレースの取りこぼしを防ぐため、記事生成APIにはpdf-parse一式を明示的に同梱する。
    outputFileTracingIncludes: {
      '/api/whitepaper-content/generate': ['./node_modules/pdf-parse/**/*'],
    },
  },
};

export default nextConfig;
