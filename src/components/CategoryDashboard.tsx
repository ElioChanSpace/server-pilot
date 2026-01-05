import React from 'react';
import { Category, Server } from '../context/ServerContext';

interface CategoryDashboardProps {
  category: Category | null; // null represents "Uncategorized"
  servers: Server[];
  allCategories: Category[];
}

// --- FIX: Replaced recursive function with a robust iterative one ---
// This prevents stack overflows and handles circular dependencies gracefully.
const getDescendantIds = (startCategoryId: string | null, allCategories: Category[]): string[] => {
  if (!startCategoryId) return [];

  const allDescendants: string[] = [];
  const queue: string[] = [startCategoryId];
  const visited: Set<string> = new Set([startCategoryId]);

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const children = allCategories.filter(c => c.parentId === currentId);

    for (const child of children) {
      if (!visited.has(child.id)) {
        visited.add(child.id);
        // We add the child to the list of descendants to be returned
        allDescendants.push(child.id);
        // We add the child to the queue to process its own children
        queue.push(child.id);
      }
    }
  }
  // We remove the starting category ID from the visited set before returning
  // because we only want the *descendants*.
  visited.delete(startCategoryId);
  return Array.from(visited);
};


export const CategoryDashboard: React.FC<CategoryDashboardProps> = ({ category, servers, allCategories }) => {
  const categoryName = category ? category.name : "Uncategorized";
  
  const relevantCategoryIds = category ? [category.id, ...getDescendantIds(category.id, allCategories)] : [null];
  
  const relevantServers = servers.filter(s => 
    relevantCategoryIds.includes(s.categoryId || null)
  );

  const totalServers = relevantServers.length;
  const connectedCount = relevantServers.filter(s => s.status === 'connected').length;
  const disconnectedCount = totalServers - connectedCount;

  return (
    <div style={{ padding: '20px' }}>
      <h1>{categoryName}</h1>
      <p style={{ color: 'var(--text-secondary)', marginTop: '8px' }}>
        Statistics for this category and all its sub-categories.
      </p>
      <div style={{ display: 'flex', gap: '20px', marginTop: '30px' }}>
        <div style={statCardStyle}>
          <div style={statValueStyle}>{totalServers}</div>
          <div style={statLabelStyle}>Total Servers</div>
        </div>
        <div style={statCardStyle}>
          <div style={statValueStyle}>{connectedCount}</div>
          <div style={statLabelStyle}>Connected</div>
        </div>
        <div style={statCardStyle}>
          <div style={statValueStyle}>{disconnectedCount}</div>
          <div style={statLabelStyle}>Disconnected</div>
        </div>
      </div>
    </div>
  );
};

const statCardStyle: React.CSSProperties = {
  backgroundColor: 'var(--glass-bg)',
  padding: '20px',
  borderRadius: '12px',
  flex: 1,
  textAlign: 'center',
  border: '1px solid var(--glass-border)',
};

const statValueStyle: React.CSSProperties = {
  fontSize: '36px',
  fontWeight: '600',
};

const statLabelStyle: React.CSSProperties = {
  fontSize: '14px',
  color: 'var(--text-secondary)',
  marginTop: '8px',
};