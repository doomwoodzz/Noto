import { api } from "./api";
import type { ActivityClient } from "../workspace/activityClient";

export const realActivityClient: ActivityClient = {
  async list(filter) {
    return (await api.activity.list(filter)).activity;
  },
  async preview(auditId) {
    return api.activity.preview(auditId);
  },
  async revert(auditId, force) {
    return api.activity.revert(auditId, force ?? false);
  },
};
