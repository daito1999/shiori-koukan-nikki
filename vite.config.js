import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pagesでは https://<ユーザー名>.github.io/<リポジトリ名>/ という
// URL構成になるため、base に「/リポジトリ名/」を指定する必要があります。
// 例: リポジトリ名が "shiori-koukan-nikki" なら
//     base: "/shiori-koukan-nikki/"
export default defineConfig({
  plugins: [react()],
  base: "/shiori-koukan-nikki/",
});
