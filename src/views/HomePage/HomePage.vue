<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { contactLinks } from "@/configs/contactLinks";
import homePageData from "@/configs/homePage.json";

interface HomeCard {
  id: string;
  href: string;
  title: string;
  titleKey?: string;
  description: string;
  descriptionKey?: string;
  icon: string;
  cover?: string;
  credit?: string;
  badge?: string;
  badgeKey?: string;
}
interface HomeCategory {
  id: string;
  title: string;
  titleKey: string;
  color: string;
  background: string;
  cards: HomeCard[];
}
const categories: HomeCategory[] = homePageData.categories;
const { t, te } = useI18n({ useScope: "global" });
const displayText = (value: string, key?: string) => key && te(key) ? t(key) : value;
</script>

<template>
  <div class="home-page">
    <div class="home-content">
      <header class="welcome">
        <img class="avatar" alt="" src="@/assets/HomePage/avatar.jpg" />
        <div>
          <h1>{{ t('homePage.ui.welcome') }}</h1>
          <p>{{ t('homePage.ui.subtitle') }}</p>
        </div>
      </header>
      <div class="categories">
        <fieldset
          v-for="category in categories"
          :key="category.id"
          class="category"
          :style="{ '--category-color': category.color, '--category-background': category.background }"
        >
          <legend>
            <h2>{{ displayText(category.title, category.titleKey) }} <span>· {{ category.cards.length }}</span></h2>
          </legend>
          <div class="card-grid">
            <a v-for="card in category.cards" :key="card.id" class="tool-card" :href="card.href">
              <span class="card-icon" aria-hidden="true">
                <img v-if="card.cover" :src="card.cover" alt="" loading="lazy" />
                <span v-else>{{ card.icon }}</span>
              </span>
              <div class="card-content">
                <div class="card-heading">
                  <h3>{{ displayText(card.title, card.titleKey) }}</h3>
                  <span v-if="card.badge?.trim()" class="card-badge">
                    {{ displayText(card.badge, card.badgeKey) }}
                  </span>
                </div>
                <p v-if="card.description">{{ displayText(card.description, card.descriptionKey) }}</p>
                <small v-if="card.credit">{{ card.credit }}</small>
              </div>
              <span class="card-arrow" aria-hidden="true">›</span>
            </a>
          </div>
        </fieldset>
      </div>
    <section v-if="contactLinks.length" class="contact-section" aria-labelledby="contact-title">
      <h2 id="contact-title">{{ t('homePage.ui.contactTitle') }}</h2>
      <div class="contact-links">
        <a v-for="contact in contactLinks" :key="contact.href" class="contact-badge"
          :href="contact.href" target="_blank" rel="noopener noreferrer"
          :aria-label="`${contact.platform}: ${contact.label}`">
          <span class="contact-platform">
            <img :src="contact.image" alt="" width="16" height="16" loading="lazy" />
            {{ contact.platform }}
          </span>
          <span class="contact-label" :style="{ backgroundColor: contact.color }">{{ contact.label }}</span>
        </a>
      </div>
    </section>
    </div>
  </div>
</template>

<style scoped>

.home-page {
  box-sizing: border-box;
  width: 100%;
  overflow-y: auto;
  scrollbar-width: none;
  padding: 24px 24px 32px;
}
.home-page::-webkit-scrollbar {
  display: none;
}
.home-content {
  max-width: 1440px;
  margin: 0 auto;
}
.welcome {
  display: flex;
  align-items: center;
  gap: 22px;
  margin: 8px 0 30px;
  text-align: left;
}
.avatar {
  width: 88px;
  height: 88px;
  object-fit: cover;
  border-radius: 22px;
  flex-shrink: 0;
}
.welcome h1 {
  margin: 0 0 10px;
  color: #24345b;
  font-size: clamp(21px, 2.2vw, 30px);
}
.welcome p {
  margin: 0;
  color: #697795;
  line-height: 1.6;
}
.categories {
  display: grid;
  gap: 24px;
}
.category {
  min-width: 0;
  margin: 0;
  padding: 0px 20px 20px;
  border: 1.5px solid var(--category-color);
  border-radius: 12px;
  background: var(--category-background);
  text-align: left;
}
.category legend {
  max-width: calc(100% - 20px);
  margin-left: 2px;
  padding: 0 10px;
  color: var(--category-color);
}
.category h2 {
  margin: 0;
  font-size: 20px;
  line-height: 1.5;
}
.category h2 span {
  white-space: nowrap;
}
.card-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
.tool-card {
  display: flex;
  align-items: center;
  gap: 18px;
  min-width: 0;
  min-height: 120px;
  box-sizing: border-box;
  padding: 0px 20px;
  border: 1px solid #ffffff;
  border-radius: 12px;
  background: #ffffffdf;
  color: #253455;
  text-decoration: none;
  box-shadow: 0 3px 12px #26376508;
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
}
.tool-card:hover {
  transform: translateY(-2px);
  border-color: var(--category-color);
  box-shadow: 0 6px 18px #26376514;
}
.tool-card:focus-visible {
  outline: 3px solid var(--category-color);
  outline-offset: 3px;
}
.card-icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 58px;
  height: 58px;
  overflow: hidden;
  border-radius: 14px;
  background: var(--category-background);
  color: var(--category-color);
  font-family: Arial, sans-serif;
  font-size: 34px;
}
.card-icon img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.card-content {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.card-heading {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 10px;
}
.card-heading h3 {
  min-width: 0;
}
.card-badge {
  display: inline-block;
  max-width: 100%;
  box-sizing: border-box;
  padding: 2px 8px;
  border: 1px solid #f5c789;
  border-radius: 999px;
  background: #fff3df;
  color: #99500b;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.card-content h3 {
  margin: 0;
  font-size: 18px;
  line-height: 1.5;
}
.card-content p {
  margin: 6px 0 0;
  color: #697795;
  font-size: 14px;
  line-height: 1.65;
}
.card-content small {
  display: block;
  margin-top: 8px;
  color: #697795;
  line-height: 1.6;
}
.card-arrow {
  flex-shrink: 0;
  color: #697795;
  font-family: Arial, sans-serif;
  font-size: 28px;
}
.card-grid > :only-child {
  grid-column: 1 / -1;
}
@media (max-width: 1100px) {
  .card-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 680px) {
  .home-page { padding: 18px 6px 24px; }
  .welcome { gap: 14px; margin-bottom: 24px; }
  .avatar { width: 60px; height: 60px; border-radius: 16px; }
  .welcome p { font-size: 14px; }
  .category { padding: 12px; }
  .category h2 { font-size: 18px; }
  .card-grid { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .tool-card { padding: 16px; gap: 14px; }
  .card-heading {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 10px;
}
.card-heading h3 {
  min-width: 0;
}
.card-badge {
  display: inline-block;
  max-width: 100%;
  box-sizing: border-box;
  padding: 2px 8px;
  border: 1px solid #f5c789;
  border-radius: 999px;
  background: #fff3df;
  color: #99500b;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.card-content h3 { font-size: 17px; }
}
@media (prefers-reduced-motion: reduce) {
  .tool-card { transition: none; }
  .tool-card:hover { transform: none; }
}
.contact-section {
  box-sizing: border-box;
  flex-shrink: 0;
  width: min(1140px, 100%);
  margin: 32px auto;
  padding: 0 20px;
}
.contact-section h2 {
  text-align: center;
  margin: 0 0 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid #6a5acd30;
  font-size: 1.4rem;
}
.contact-links {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
}
.contact-badge {
  display: inline-flex;
  max-width: 100%;
  overflow: hidden;
  border-radius: 4px;
  color: #fff;
  text-decoration: none;
  font-size: 13px;
  line-height: 1.5;
  box-shadow: 0 1px 2px #0002;
  transition: filter 0.15s;
}
.contact-badge:hover {
  filter: brightness(1.1);
}
.contact-badge:focus-visible {
  outline: 3px solid #6a5acd;
  outline-offset: 3px;
}
.contact-platform,
.contact-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
}
.contact-platform {
  flex-shrink: 0;
  background: #555;
}
.contact-platform img {
  object-fit: contain;
  flex-shrink: 0;
}
.contact-label {
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
