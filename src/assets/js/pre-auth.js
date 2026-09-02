document.addEventListener('DOMContentLoaded', () => {
    const roleId = localStorage.getItem('userRoleId');
    if (!roleId) return;
    
    const isSpectator = roleId === '6' || roleId === 6;
    const isRestricted = (roleId === '2' || roleId === '3') && !isSpectator;
    const isAccountant = roleId === '3';
    const isSuperAdmin = roleId === '1';

    const receiptsNavItem = document.getElementById('receiptsNavItem');
    if (receiptsNavItem) {
      if (isAccountant || isSuperAdmin) {
        receiptsNavItem.classList.remove('d-none');
        receiptsNavItem.style.display = '';
      } else {
        receiptsNavItem.classList.add('d-none');
        receiptsNavItem.style.display = 'none';
      }
    }

    const resourcesNavItem = document.getElementById('resourcesNavItem');
    const resourcesCardCol = document.getElementById('resourcesCardCol');
    if (resourcesNavItem) {
      if (isRestricted) {
        resourcesNavItem.classList.add('d-none');
        resourcesNavItem.style.display = 'none';
      } else {
        resourcesNavItem.classList.remove('d-none');
        resourcesNavItem.style.display = '';
      }
    }
    if (resourcesCardCol) {
      if (isRestricted) {
        resourcesCardCol.classList.add('d-none');
        resourcesCardCol.style.display = 'none';
      } else {
        resourcesCardCol.classList.remove('d-none');
        resourcesCardCol.style.display = '';
      }
    }

    const shiftsNavItem = document.getElementById('shiftsNavItem');
    const shiftsCardCol = document.getElementById('shiftsCardCol');
    if (shiftsNavItem) {
      if (isAccountant) {
        shiftsNavItem.classList.add('d-none');
        shiftsNavItem.style.display = 'none';
      } else {
        shiftsNavItem.classList.remove('d-none');
        shiftsNavItem.style.display = '';
      }
    }
    if (shiftsCardCol) {
      if (isAccountant) {
        shiftsCardCol.classList.add('d-none');
        shiftsCardCol.style.display = 'none';
      } else {
        shiftsCardCol.classList.remove('d-none');
        shiftsCardCol.style.display = '';
      }
    }

    const timesheetNavItem = document.getElementById('timesheetNavItem');
    const timesheetCardCol = document.getElementById('timesheetCardCol');
    if (timesheetNavItem) {
      if (isAccountant || isSuperAdmin) {
        timesheetNavItem.classList.remove('d-none');
        timesheetNavItem.style.display = '';
      } else {
        timesheetNavItem.classList.add('d-none');
        timesheetNavItem.style.display = 'none';
      }
    }
    if (timesheetCardCol) {
      if (isAccountant || isSuperAdmin) {
        timesheetCardCol.classList.remove('d-none');
        timesheetCardCol.style.display = '';
      } else {
        timesheetCardCol.classList.add('d-none');
        timesheetCardCol.style.display = 'none';
      }
    }

    const receiptsCardCol = document.getElementById('receiptsCardCol');
    if (receiptsCardCol) {
      if (isAccountant || isSuperAdmin) {
        receiptsCardCol.classList.remove('d-none');
        receiptsCardCol.style.display = '';
      } else {
        receiptsCardCol.classList.add('d-none');
        receiptsCardCol.style.display = 'none';
      }
    }
});
