<template>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <template v-if="name === 'sparkles'"><path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3L12 3Z"/><path d="m20 2 .7 2.3L23 5l-2.3.7L20 8l-.7-2.3L17 5l2.3-.7L20 2Z"/></template>
    <template v-else-if="name === 'plus'"><path d="M12 5v14M5 12h14"/></template>
    <template v-else-if="name === 'chat'"><path d="M21 11a8 8 0 0 1-8 8H5l-3 3V11a8 8 0 0 1 8-8h3a8 8 0 0 1 8 8Z"/><path d="M7 9h10M7 13h6"/></template>
    <template v-else-if="name === 'settings'"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><path d="m9 3-.6 2.5L6 7l-2.5-.5L2 9l1.9 2v3L2 16l1.5 2.5L6 18l2.4 1.5L9 22h3l.6-2.5L15 18l2.5.5L19 16l-1.9-2v-3L19 9l-1.5-2.5L15 7l-2.4-1.5L12 3H9Z" transform="translate(1 -1) scale(.96)"/></template>
    <template v-else-if="name === 'sound'"><path d="M5 9H2v6h3l5 4V5L5 9Z"/><path d="M14 8a6 6 0 0 1 0 8M17 5a10 10 0 0 1 0 14"/></template>
    <template v-else-if="name === 'effect'"><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/><path d="m18 2 3 3M2 18l3 3"/></template>
    <template v-else-if="name === 'music'"><path d="M9 18V5l12-2v13M9 8l12-2"/><ellipse cx="5" cy="18" rx="4" ry="3"/><ellipse cx="17" cy="16" rx="4" ry="3"/></template>
    <template v-else-if="name === 'arrow'"><path d="m4 12 16-8-5 16-3-7-8-1Z"/><path d="m12 13 8-9"/></template>
    <template v-else-if="name === 'send-up'"><path d="M12 19V5m-6 6 6-6 6 6"/></template>
    <template v-else-if="name === 'chevron'"><path d="m6 9 6 6 6-6"/></template>
    <template v-else-if="name === 'search'"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></template>
    <template v-else-if="name === 'external'"><path d="M14 3h7v7M21 3 11 13M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/></template>
    <template v-else-if="name === 'close'"><path d="m6 6 12 12M18 6 6 18"/></template>
    <template v-else-if="name === 'menu'"><path d="M4 6h16M4 12h16M4 18h16"/></template>
    <template v-else-if="name === 'edit'"><path d="m16 3 5 5-12 12-6 1 1-6L16 3ZM13 6l5 5"/></template>
    <template v-else-if="name === 'trash'"><path d="M3 6h18M8 6V3h8v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></template>
    <template v-else-if="name === 'reset'"><path d="M3 11a9 9 0 1 1 2 7M3 4v7h7"/></template>
    <template v-else-if="name === 'check'"><path d="m5 12 4 4L19 6"/></template>
    <template v-else-if="name === 'copy'"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></template>
    <template v-else-if="name === 'eye'"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></template>
    <template v-else-if="name === 'shield'"><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/></template>
    <template v-else><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></template>
  </svg>
</template>

<script setup lang="ts">
defineProps<{ name: string }>()
</script>
