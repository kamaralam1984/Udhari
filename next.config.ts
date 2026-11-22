import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit loads its built-in font files from disk and exceljs is large — keep both out of the server bundle.
  serverExternalPackages: ["pdfkit", "exceljs"],
};

export default nextConfig;
