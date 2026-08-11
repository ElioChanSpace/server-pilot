export const getBaseName = (filePath: string) => {
  const segments = filePath.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? filePath;
};

export const joinRemotePath = (basePath: string, name: string) => {
  if (basePath === "/") {
    return `/${name}`;
  }

  return `${basePath.replace(/\/+$/, "")}/${name}`;
};

export const createTransferId = () => `upload-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
