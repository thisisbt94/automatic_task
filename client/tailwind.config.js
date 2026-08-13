/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#12131A",
        paper: "#FAF9F6",
        brand: {
          50: "#F0F4FF",
          100: "#DCE6FF",
          400: "#5C7CFA",
          500: "#3B5BFF",
          600: "#2A44E0",
          900: "#141B4D",
        },
        good: "#1E9E6B",
        mid: "#C98A17",
        low: "#C64A3D",
      },
      fontFamily: {
        display: ["'Space Grotesk'", "system-ui", "sans-serif"],
        body: ["'Inter'", "system-ui", "sans-serif"],
      },
      borderRadius: {
        xl2: "1.25rem",
      },
    },
  },
  plugins: [],
};
