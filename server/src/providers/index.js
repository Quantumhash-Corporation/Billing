import assemblyai from './assemblyai.js';
import mailbaby from './mailbaby.js';
import mistral from './mistral.js';
import ollama from './ollama.js';
import openai from './openai.js';
import recall from './recall.js';

// Order here is the order on the shelf.
export const providers = [openai, mistral, assemblyai, recall, ollama, mailbaby];

export const providerById = new Map(providers.map((p) => [p.id, p]));
