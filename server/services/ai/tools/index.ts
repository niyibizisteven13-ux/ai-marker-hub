import type { Tool, ToolServices } from '../types.js';
import { ToolRegistry } from './registry.js';
import { createArchive, createDocument, createPresentation, createSpreadsheet, createTextFile } from './fileTools.js';
import { createChart, createDiagram, createDrawing, generateImage } from './drawingTools.js';
import { pythonTool, readAttachment, searchKnowledgeTool, webTools } from './dataTools.js';

/** Builds the full toolkit. Tools that need an optional service are only included when it is provided. */
export function buildToolkit(services: ToolServices = {}): ToolRegistry {
  const tools: Array<Tool | null> = [
    createDocument, createSpreadsheet, createPresentation, createTextFile, createArchive,
    createDrawing, createChart, createDiagram,
    services.image ? generateImage : null,
    readAttachment,
    searchKnowledgeTool(services),
    ...webTools(services),
    pythonTool(services),
  ];
  return new ToolRegistry(tools.filter((t): t is Tool => !!t));
}

export * from './registry.js';
