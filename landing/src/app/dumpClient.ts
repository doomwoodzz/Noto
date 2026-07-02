import { api } from "./api";
import type { DumpClient } from "../workspace/dumpClient";

export const realDumpClient: DumpClient = {
  async start(source) {
    return api.dump.start(source);
  },
  async poll(jobId) {
    return api.dump.poll(jobId);
  },
  async commit(jobId, selectedItemIds, updates) {
    await api.dump.commit(jobId, selectedItemIds, updates);
  },
  async cancel(jobId) {
    await api.dump.cancel(jobId);
  },
  async remove(jobId, purgeNotes) {
    await api.dump.remove(jobId, purgeNotes);
  },
  async githubRepos() {
    return (await api.dump.githubRepos()).repos;
  },
  async notionPages() {
    return (await api.dump.notionPages()).pages;
  },
  async connectors() {
    return (await api.dump.connectors()).connectors;
  },
  async disconnect(provider) {
    await api.dump.disconnect(provider);
  },
};
