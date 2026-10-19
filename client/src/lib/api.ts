export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(path, {
      ...init,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      credentials: "include",
    });
    const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) throw new Error(payload.error || "Não foi possível concluir a operação.");
    return payload;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("Servidor local sem resposta. Tentando novamente…");
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function readImage(file: File | undefined): Promise<string | null> {
  if (!file) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => reject(new Error("Não foi possível carregar a imagem."));
    reader.readAsDataURL(file);
  });
}
