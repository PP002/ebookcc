export const getApiUrl = () => {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  if (import.meta.env.DEV) return "";
  // Return empty string to use relative paths for API calls to Cloudflare or current domain
  return "";
};
