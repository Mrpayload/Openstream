export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

export const getAbsoluteApiUrl = (path) => {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${cleanPath}`;
};
