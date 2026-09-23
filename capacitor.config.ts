import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.utahcity.host",
  appName: "Utah City",
  webDir: "www",
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
      style: "DARK",
      backgroundColor: "#070b12",
    },
  },
  ios: {
    scheme: "Utah City",
    contentInset: "automatic",
    allowsLinkPreview: false,
    scrollEnabled: true,
    preferredContentMode: "mobile",
  },
};

export default config;

