export const getApiUrl = () => {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  if (import.meta.env.DEV) return "";
  return "https://ebookcc-353634510382.europe-west1.run.app";
};
