<template>
  <div class="user-badge" @click="handleClick">
    <img :src="avatar" alt="avatar" class="avatar" />
    <span class="username">{{ name }}</span>
  </div>
</template>

<script setup>
const props = defineProps({
  avatar: { type: String, required: true },
  name: { type: String, required: true },
  link: { type: String, required: false },
  openInNewTab: { type: Boolean, default: false },
  function: { type: Function, required: false }
})

const handleClick = () => {
  if (props.link == null) {
    props.function();
    return;
  }
  if (props.openInNewTab) {
    window.open(props.link, '_blank')
  } else {
    window.location.href = props.link
  }
}
</script>

<style scoped>
.user-badge {
  /* position: fixed; */
  top: 16px;
  right: 16px;
  display: flex;
  align-items: center;
  background-color: white;
  border: 1px solid #ddd;
  border-radius: 9999px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
  padding: 6px 12px;
  cursor: pointer;
  transition: 0.2s;
}

.user-badge:hover {
  transform: scale(1.03);
  background-color: #f0f8ff;
}

.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
  margin-right: 8px;
}

.username {
  font-weight: 500;
  color: #333;
  font-size: 14px;
}
</style>
