// Shared cart utilities

function updateCartBadge(count) {
  const badge = document.getElementById('cart-badge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
  }
}

function showToast(message, type) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast toast-' + (type || 'info');
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('show'));

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// Add to cart from menu page
function addToCart(productId) {
  fetch('/cart/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      productId: productId,
      size: 'M',
      options: [],
      quantity: 1,
    }),
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.rollback) {
      // FP-1: Optimistic update then rollback
      showToast('Added to cart!', 'success');
      var currentCount = parseInt(document.getElementById('cart-badge').textContent) || 0;
      updateCartBadge(currentCount + 1);
      setTimeout(function() {
        showToast('Sorry, item went out of stock', 'error');
        updateCartBadge(currentCount);
      }, 300);
    } else if (data.success) {
      showToast('Added to cart!', 'success');
      updateCartBadge(data.cartCount);
    } else {
      showToast(data.error || 'Failed to add', 'error');
    }
  })
  .catch(function() {
    showToast('Failed to add to cart', 'error');
  });
}
