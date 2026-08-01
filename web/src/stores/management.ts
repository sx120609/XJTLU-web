import { defineStore } from "pinia";
import {
  clearManagementToken,
  hydrateManagementToken,
  managementApi,
  readManagementToken,
  setManagementToken,
  type ManagementPrincipal,
} from "@/api/management";

export const useManagementStore = defineStore("management", {
  state: () => ({
    token: "",
    principal: null as ManagementPrincipal | null,
    ready: false,
    loading: false,
  }),
  getters: {
    isAuthenticated: (state) => Boolean(state.token && state.principal),
    isBoss: (state) => state.principal?.accountType === "boss",
  },
  actions: {
    hydrate() {
      this.token = hydrateManagementToken();
    },
    hasPermission(code: string) {
      return this.principal?.accountType === "boss" || Boolean(this.principal?.permissions.includes(code));
    },
    async login(input: { username: string; password: string; otp?: string }) {
      this.loading = true;
      try {
        const result = await managementApi.login(input);
        setManagementToken(result.token);
        this.token = result.token;
        this.principal = await managementApi.me({ suppressAuthRedirect: true });
        this.ready = true;
      } catch (error) {
        this.clear();
        throw error;
      } finally {
        this.loading = false;
      }
    },
    async fetchMe(options?: { silent?: boolean }) {
      if (!this.token) this.token = readManagementToken() || hydrateManagementToken();
      if (!this.token) {
        this.principal = null;
        this.ready = true;
        return false;
      }
      try {
        this.principal = await managementApi.me({
          suppressAuthRedirect: true,
          suppressErrorMessage: options?.silent ?? true,
        });
        return true;
      } catch {
        this.clear();
        return false;
      } finally {
        this.ready = true;
      }
    },
    async logout(all = false) {
      try {
        if (this.token) await (all ? managementApi.logoutAll() : managementApi.logout());
      } finally {
        this.clear();
      }
    },
    clear() {
      clearManagementToken();
      this.token = "";
      this.principal = null;
      this.ready = true;
    },
  },
});
