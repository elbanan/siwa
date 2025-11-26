export type GenerationTask = {
  id: string;
  name: string;
  description?: string | null;
  model_id: string;
  system_prompt: string;
  params: {
    temperature?: number | null;
    top_p?: number | null;
    top_k?: number | null;
    max_tokens?: number | null;
    presence_penalty?: number | null;
    frequency_penalty?: number | null;
  };
  created_at: string;
  updated_at?: string | null;
};
