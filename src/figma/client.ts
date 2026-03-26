import type { FigmaFileResponse, FigmaNode } from "../types/figma.js";

const FIGMA_API_BASE = "https://api.figma.com/v1";

export class FigmaClient {
  private readonly accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  private async request<T>(path: string): Promise<T> {
    const response = await fetch(`${FIGMA_API_BASE}${path}`, {
      headers: {
        "X-Figma-Token": this.accessToken,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Figma API error ${response.status}: ${body}`);
    }

    return response.json() as Promise<T>;
  }

  async getFile(fileKey: string): Promise<FigmaFileResponse> {
    return this.request<FigmaFileResponse>(`/files/${fileKey}`);
  }

  async getFileNodes(fileKey: string, nodeIds: string[]): Promise<{ nodes: Record<string, { document: FigmaNode }> }> {
    const ids = nodeIds.join(",");
    return this.request(`/files/${fileKey}/nodes?ids=${encodeURIComponent(ids)}`);
  }

  async getStyles(fileKey: string): Promise<{ styles: Record<string, unknown> }> {
    return this.request(`/files/${fileKey}/styles`);
  }
}
