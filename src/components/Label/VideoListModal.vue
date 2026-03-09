<template>
  <div>
    <!-- 触发按钮 -->
    <div class="user-badge" @click="openModal">
      <img src="/images/7.ico" alt="avatar" class="avatar" />
      <span class="username">你可能会需要的...</span>
    </div>

    <!-- 遮罩 & 弹框 -->
    <div v-if="isOpen" class="modal-overlay" @click.self="closeModal">
      <div class="modal-content">
        <button class="close-btn" @click="closeModal">✖</button>

        <h2 class="modal-title">{{ modalTitle }}</h2>

        <!-- 视频列表 -->
        <ul class="video-list">
          <li v-for="(video, index) in videos" :key="index" class="video-item" @click="goLink(video.link)">
            <img :src="video.cover" alt="视频封面" class="video-cover" />
            <div class="video-info">
              <h3 class="video-title">{{ video.title }}</h3>
            </div>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const props = defineProps({
  modalTitle: { type: String, default: '视频列表' },
  videos: {
    type: Array,
    default: () => [
      { cover: '/images/video1.png', title: '视频 1', link: '#' },
      { cover: '/images/video2.png', title: '视频 2', link: '#' },
      { cover: '/images/video3.png', title: '视频 3', link: '#' }
    ]
  }
})

const isOpen = ref(false)
const openModal = () => (isOpen.value = true)
const closeModal = () => (isOpen.value = false)

// 点击跳转
const goLink = (url) => {
  window.open(url, '_blank')
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

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 999;
}

.modal-content {
  background: #fff;
  border-radius: 1rem;
  padding: 1.5rem;
  width: 90%;
  max-width: 600px;
  position: relative;
  overflow-y: auto;
  max-height: 80vh;
}

.close-btn {
  position: absolute;
  top: 12px;
  right: 12px;
  border: none;
  background: none;
  font-size: 1.2rem;
  cursor: pointer;
}

.modal-title {
  text-align: center;
  margin-bottom: 1rem;
  color: black
}

.video-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.video-item {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  align-items: center;
  cursor: pointer;
  transition: 0.2s;
}

.video-item:hover {
  transform: scale(1.02);
  background: #f0f8ff;
  border-radius: 0.5rem;
}

.video-cover {
  width: 120px;
  height: 68px;
  object-fit: cover;
  border-radius: 0.5rem;
}

.video-info {
  flex: 1;
}

.video-title {
  margin: 0;
  font-size: 16px;
  font-weight: 500;
  color: black
}
</style>
