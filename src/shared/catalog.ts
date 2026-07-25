import type { CatalogModel } from './types'

// Kuratorowana lista popularnych modeli z biblioteki Ollamy.
// Ollama nie udostepnia lokalnego API wyszukiwania w bibliotece,
// wiec laczymy te liste z mozliwoscia wpisania dowolnej nazwy do pobrania.
export const MODEL_CATALOG: CatalogModel[] = [
  { name: 'llama3.2', description: 'Meta Llama 3.2 - lekki, uniwersalny model.', sizes: ['1b', '3b'], category: 'Ogolne' },
  { name: 'llama3.1', description: 'Meta Llama 3.1 - mocny model ogolnego przeznaczenia.', sizes: ['8b', '70b'], category: 'Ogolne' },
  { name: 'qwen2.5', description: 'Qwen 2.5 - swietny w wielu jezykach i kodowaniu.', sizes: ['0.5b', '1.5b', '3b', '7b', '14b', '32b'], category: 'Ogolne' },
  { name: 'qwen2.5-coder', description: 'Qwen 2.5 Coder - wyspecjalizowany w programowaniu.', sizes: ['1.5b', '7b', '14b', '32b'], category: 'Kodowanie' },
  { name: 'gemma2', description: 'Google Gemma 2 - wydajny model open.', sizes: ['2b', '9b', '27b'], category: 'Ogolne' },
  { name: 'phi3.5', description: 'Microsoft Phi 3.5 - maly, ale sprytny.', sizes: ['3.8b'], category: 'Ogolne' },
  { name: 'mistral', description: 'Mistral 7B - szybki i solidny.', sizes: ['7b'], category: 'Ogolne' },
  { name: 'mistral-nemo', description: 'Mistral Nemo - 12B, duzy kontekst.', sizes: ['12b'], category: 'Ogolne' },
  { name: 'deepseek-coder-v2', description: 'DeepSeek Coder V2 - kodowanie.', sizes: ['16b', '236b'], category: 'Kodowanie' },
  { name: 'codellama', description: 'Code Llama - generowanie i uzupelnianie kodu.', sizes: ['7b', '13b', '34b', '70b'], category: 'Kodowanie' },
  { name: 'llava', description: 'LLaVA - model multimodalny (obraz + tekst).', sizes: ['7b', '13b', '34b'], category: 'Wizja' },
  { name: 'nomic-embed-text', description: 'Embeddingi tekstu (do RAG).', sizes: ['latest'], category: 'Embeddingi' },
  { name: 'starcoder2', description: 'StarCoder2 - kodowanie.', sizes: ['3b', '7b', '15b'], category: 'Kodowanie' },
  { name: 'tinyllama', description: 'TinyLlama - bardzo lekki, do testow.', sizes: ['1.1b'], category: 'Ogolne' }
]
