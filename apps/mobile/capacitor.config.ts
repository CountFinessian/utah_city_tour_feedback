import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.utahcity.host",
  appName: "Utah City",
  webDir: "www",
  backgroundColor: "#070b12",
  server: {
    url: "https://www.utahcity.app",
    cleartext: false,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 1500,
      backgroundColor: "#070b12",
    },
    StatusBar: {
      style: "LIGHT",
      backgroundColor: "#070b12",
      overlaysWebView: true,
    },
  },
  ios: {
    scheme: "Utah City",
    backgroundColor: "#070b12",
    contentInset: "never",
    allowsLinkPreview: false,
    scrollEnabled: false,
    preferredContentMode: "mobile",
  },
};

export default config;

