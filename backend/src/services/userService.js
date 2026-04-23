import { UserModel } from '../models/User.js';
import { LicenseService } from '../services/licenseService.js';
import { ROLES } from '../constants/roles.js';

export class UserService {
  /**
   * Throws if org has reached seat limit (member and org_admin each use one seat).
   * @param {number} organizationId
   */
  static async assertMemberSeatsAvailable(organizationId) {
    const limit = await LicenseService.resolveSeatLimit(organizationId);
    if (limit == null) return;
    const count = Number(await UserModel.countMembersByOrganizationId(organizationId));
    if (count >= Number(limit)) {
      const err = new Error('Member seat limit reached for this organization');
      err.code = 'SEAT_LIMIT';
      throw err;
    }
  }

  static consumesOrgSeat(role, organizationId) {
    return (
      organizationId != null &&
      (role === ROLES.MEMBER || role === ROLES.ORG_ADMIN)
    );
  }

  static async getAllUsers() {
    const users = await UserModel.findAll();
    return users.map((user) => this.convertToDTO(user));
  }

  static async getUsersByOrganizationId(organizationId) {
    const users = await UserModel.findByOrganizationId(organizationId);
    return users.map((user) => this.convertToDTO(user));
  }

  static async getUserById(id) {
    const user = await UserModel.findById(id);
    if (!user) {
      throw new Error('User not found with id: ' + id);
    }
    return this.convertToDTO(user);
  }

  static async createUser(userDTO) {
    if (await UserModel.existsByEmail(userDTO.email)) {
      throw new Error('Email already exists');
    }
    if (
      UserService.consumesOrgSeat(userDTO.role, userDTO.organizationId)
    ) {
      await UserService.assertMemberSeatsAvailable(userDTO.organizationId);
    }
    const user = await UserModel.create(userDTO);
    return this.convertToDTO(user);
  }

  static async updateUser(id, userDTO) {
    const existingUser = await UserModel.findById(id);
    if (!existingUser) {
      throw new Error('User not found with id: ' + id);
    }

    if (userDTO.email && userDTO.email !== existingUser.email) {
      if (await UserModel.existsByEmail(userDTO.email)) {
        throw new Error('Email already exists');
      }
    }

    const newOrgId =
      userDTO.organizationId !== undefined ? userDTO.organizationId : existingUser.organization_id;
    const newRole = userDTO.role !== undefined ? userDTO.role : existingUser.role;
    const wasSeat = UserService.consumesOrgSeat(existingUser.role, existingUser.organization_id);
    const willSeat = UserService.consumesOrgSeat(newRole, newOrgId);
    if (willSeat && (!wasSeat || newOrgId !== existingUser.organization_id)) {
      await UserService.assertMemberSeatsAvailable(newOrgId);
    }

    const updatedUser = await UserModel.update(id, userDTO);
    return this.convertToDTO(updatedUser);
  }

  static async deleteUser(id) {
    const user = await UserModel.findById(id);
    if (!user) {
      throw new Error('User not found with id: ' + id);
    }
    await UserModel.delete(id);
  }

  /**
   * Org admin creates a user in their tenant.
   */
  static async createOrgMember(organizationId, { name, email, password, phoneNumber, role = ROLES.MEMBER }) {
    if (role === ROLES.PLATFORM_ADMIN) {
      throw new Error('Invalid role');
    }
    if (await UserModel.existsByEmail(email)) {
      throw new Error('Email already exists');
    }
    if (UserService.consumesOrgSeat(role, organizationId)) {
      await UserService.assertMemberSeatsAvailable(organizationId);
    }
    const user = await UserModel.create({
      name,
      email,
      password,
      phoneNumber,
      role,
      organizationId
    });
    return this.convertToDTO(user);
  }

  static convertToDTO(user) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phoneNumber: user.phone_number,
      role: user.role,
      organizationId: user.organization_id ?? null,
      createdAt: user.created_at
    };
  }
}
