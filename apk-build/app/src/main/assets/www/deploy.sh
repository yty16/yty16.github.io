#!/bin/bash
# 部署脚本 - 将网站推送到 GitHub
# 在你自己的终端（已登录GitHub的）中运行此脚本

echo "=== 部署 yty16.github.io ==="

# 进入项目目录
cd "C:\Users\Yin\WorkBuddy\2026-06-12-10-40-19"

# 推送到 GitHub
git push -u origin main

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ 推送成功！"
    echo ""
    echo "网站地址: https://yty16.github.io/"
    echo ""
    echo "接下来需要启用 GitHub Pages:"
    echo "1. 打开 https://github.com/yty16/yty16.github.io/settings/pages"
    echo "2. Source 选择 'Deploy from a branch'"
    echo "3. Branch 选择 'main' /(root)"
    echo "4. 点击 Save"
    echo ""
    echo "大约1分钟后网站就会上线！"
else
    echo "❌ 推送失败，请检查："
    echo "1. 你是否已登录 GitHub（浏览器里能访问 github.com）"
    echo "2. 仓库 yty16.github.io 是否已创建"
    echo ""
    echo "如果需要登录，运行："
    echo "  git config --global credential.helper manager"
    echo "  然后再运行 git push"
fi