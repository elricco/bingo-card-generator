import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import HomeView from "./HomeView.vue";

describe("HomeView", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("zeigt den Titel an", () => {
    const wrapper = mount(HomeView);
    expect(wrapper.text()).toContain("Bingo Card Generator");
  });

  it("zeigt einen Twitch-Login-Link", () => {
    const wrapper = mount(HomeView);
    const link = wrapper.find("a");
    expect(link.text()).toContain("Mit Twitch einloggen");
    expect(link.attributes("href")).toContain("/auth/twitch");
  });
});
