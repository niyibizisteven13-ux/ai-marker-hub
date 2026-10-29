import type { Tool, ToolServices } from '../types.js';
import { ToolRegistry } from './registry.js';
import { createArchive, createDocument, createPresentation, createSpreadsheet, createTextFile } from './fileTools.js';
import { createChart, createDiagram, createDrawing, generateImage } from './drawingTools.js';
import { pythonTool, readAttachment, searchKnowledgeTool, webTools } from './dataTools.js';
import { outputTools } from './outputTools.js';
import { datasetTools } from './datasetTools.js';
import { memoryTools } from './memoryTools.js';
import { sceneTools } from './sceneTools.js';
import { formTools } from './formTools.js';
import { analyzeDocument, viewPages } from './documentTools.js';

/** Builds the full toolkit. Tools that need an optional service are only included when it is provided. */
export function buildToolkit(services: ToolServices = {}): ToolRegistry {
  const enabled = (name: string) => process.env[name] === 'true';
  const tools: Array<Tool | null> = [
    createDocument, createSpreadsheet, createPresentation, createTextFile, createArchive,
    createDrawing, createChart, createDiagram,
    ...(process.env.ENABLE_3D_TOOLS === 'false' ? [] : sceneTools),
    ...(process.env.ENABLE_FORM_TOOLS === 'false' ? [] : formTools(services)),
    enabled('ENABLE_AGENT_IMAGE_GENERATION') && services.image ? generateImage : null,
    readAttachment,
    services.llm ? analyzeDocument : null,
    viewPages,
    searchKnowledgeTool(services),
    ...datasetTools(services),
    ...memoryTools(services),
    ...(enabled('ENABLE_AGENT_WEB_TOOLS') ? webTools(services) : []),
    enabled('ENABLE_AGENT_PYTHON_TOOL') ? pythonTool(services) : null,
    ...(process.env.ENABLE_OUTPUT_ENGINE_TOOLS === 'false' ? [] : outputTools(services)),
  ];
  return new ToolRegistry(tools.filter((t): t is Tool => !!t));
}

export * from './registry.js';
